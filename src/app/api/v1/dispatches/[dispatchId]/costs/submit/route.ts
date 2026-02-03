import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireSupplier, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { chooseFlag, eligibleExtraKm, eligibleExtraMinutes } from "@/lib/costs";
import { totalDistanceKm } from "@/lib/geo";
import type { CostValidationFlag } from "@prisma/client";

interface RouteParams {
  params: { dispatchId: string };
}

const submitSchema = z.object({
  exitValueCents: z.number().int().min(0),
  extraKm: z.number().int().min(0),
  extraHourMinutes: z.number().int().min(0),
  reimbursements: z.array(z.record(z.unknown())).optional(),
  evidenceAttachmentIds: z.array(z.string().min(1)).optional()
});

function computeMeasuredMinutes(startedAt: Date | null, endedAt: Date | null): number | null {
  if (!startedAt) return null;
  const end = endedAt ?? new Date();
  const diffMs = Math.max(0, end.getTime() - startedAt.getTime());
  return Math.round(diffMs / 60000);
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireSupplier(user);

    const body = await readJson<z.infer<typeof submitSchema>>(request);
    const input = submitSchema.parse(body);

    const dispatch = await prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      include: {
        approvedSupplierCompany: true,
        fieldSessions: {
          include: {
            gpsPoints: { orderBy: { recordedAt: "asc" } }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!dispatch) {
      throw new ApiError(404, "Dispatch not found");
    }

    if (!dispatch.approvedSupplierCompanyId) {
      throw new ApiError(409, "Dispatch has no approved supplier");
    }

    if (dispatch.approvedSupplierCompanyId !== user.supplierCompanyId) {
      throw new ApiError(403, "Forbidden");
    }

    if (dispatch.status === "REJECTED" || dispatch.status === "CLOSED") {
      throw new ApiError(409, "Dispatch is closed or rejected");
    }

    if (!dispatch.approvedSupplierCompany) {
      throw new ApiError(500, "Approved supplier data missing");
    }

    const supplier = dispatch.approvedSupplierCompany;

    const gpsPoints = dispatch.fieldSessions
      .flatMap((session) =>
        session.gpsPoints.map((point) => ({
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          recordedAt: point.recordedAt
        }))
      )
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    const distancePoints = gpsPoints.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude
    }));
    const totalKm = distancePoints.length >= 2 ? totalDistanceKm(distancePoints) : 0;
    const measuredKm = distancePoints.length >= 2 ? Math.round(totalKm) : null;

    const fieldSession = dispatch.fieldSessions[dispatch.fieldSessions.length - 1] ?? null;
    const startedAt = dispatch.fieldStartedAt ?? fieldSession?.startedAt ?? null;
    const endedAt = fieldSession?.closedAt ?? null;
    const measuredMinutes = computeMeasuredMinutes(startedAt, endedAt);

    let validationFlag: CostValidationFlag = "OK";
    const validationNotes: string[] = [];

    if (input.extraKm > 0) {
      if (measuredKm === null) {
        if (!input.evidenceAttachmentIds || input.evidenceAttachmentIds.length === 0) {
          validationFlag = chooseFlag(validationFlag, "MISSING_EVIDENCE");
          validationNotes.push("KM adicional sem trilha GPS e sem evidência anexada.");
        } else {
          validationFlag = chooseFlag(validationFlag, "NEEDS_REVIEW");
          validationNotes.push("KM adicional sem trilha GPS. Evidência anexada.");
        }
      } else {
        const eligibleKm = eligibleExtraKm(measuredKm, supplier) ?? 0;
        if (input.extraKm > eligibleKm) {
          validationFlag = chooseFlag(validationFlag, "GPS_MISMATCH");
          validationNotes.push(
            `KM adicional informado (${input.extraKm}) excede elegível (${eligibleKm}) com franquia ${supplier.includedKm}km e medido ${measuredKm}km.`
          );
        }
      }
    }

    if (input.extraHourMinutes > 0) {
      if (measuredMinutes === null) {
        validationFlag = chooseFlag(validationFlag, "NEEDS_REVIEW");
        validationNotes.push("Hora adicional sem timestamp de início.");
      } else {
        const eligibleMinutes = eligibleExtraMinutes(measuredMinutes, supplier) ?? 0;
        if (input.extraHourMinutes > eligibleMinutes) {
          validationFlag = chooseFlag(validationFlag, "TIME_MISMATCH");
          validationNotes.push(
            `Hora adicional informada (${input.extraHourMinutes} min) excede elegível (${eligibleMinutes} min) com franquia ${supplier.includedMinutes} min e medido ${measuredMinutes} min.`
          );
        }
      }
    }

    const cost = await prisma.$transaction(async (tx) => {
      const record = await tx.costBreakdown.upsert({
        where: { dispatchId: dispatch.id },
        update: {
          exitValueCents: input.exitValueCents,
          extraKm: input.extraKm,
          extraHourMinutes: input.extraHourMinutes,
          reimbursements: input.reimbursements ?? null,
          measuredKm,
          measuredMinutes,
          validationFlag,
          validationNotes: validationNotes.length ? validationNotes.join(" ") : null,
          submittedByUserId: user.id,
          submittedAt: new Date()
        },
        create: {
          dispatchId: dispatch.id,
          exitValueCents: input.exitValueCents,
          extraKm: input.extraKm,
          extraHourMinutes: input.extraHourMinutes,
          reimbursements: input.reimbursements ?? null,
          measuredKm,
          measuredMinutes,
          validationFlag,
          validationNotes: validationNotes.length ? validationNotes.join(" ") : null,
          submittedByUserId: user.id,
          submittedAt: new Date()
        }
      });

      await tx.auditEvent.create({
        data: {
          dispatchId: dispatch.id,
          actorType: "USER",
          actorUserId: user.id,
          eventType: "COST_SUBMITTED",
          payload: {
            exitValueCents: input.exitValueCents,
            extraKm: input.extraKm,
            extraHourMinutes: input.extraHourMinutes,
            evidenceAttachmentIds: input.evidenceAttachmentIds ?? []
          }
        }
      });

      return record;
    });

    return jsonOk({
      id: cost.id,
      validationFlag: cost.validationFlag,
      measuredKm: cost.measuredKm,
      measuredMinutes: cost.measuredMinutes
    });
  } catch (error) {
    return jsonError(error);
  }
}
