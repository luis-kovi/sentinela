import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJson, jsonError, jsonOk } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { normalizePlate } from "@/lib/plates";
import { ApiError } from "@/lib/errors";
import { DispatchReason, DispatchStatus } from "@prisma/client";

const locationSchema = z.object({
  address: z.string().min(3),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const vehicleSnapshotSchema = z
  .object({
    model: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    year: z.number().int().min(1900).max(2100).optional()
  })
  .optional();

const createDispatchSchema = z.object({
  plate: z.string().min(1),
  vehicleSnapshot: vehicleSnapshotSchema,
  location: locationSchema,
  driverName: z.string().min(1).optional(),
  reason: z.nativeEnum(DispatchReason),
  reasonDetails: z.string().optional().nullable(),
  supplierCompanyIds: z.array(z.string().min(1)).min(1)
});

function parseDispatchStatus(value: string | null): DispatchStatus | null {
  if (!value) return null;
  const allowed: DispatchStatus[] = [
    "QUOTING",
    "APPROVED",
    "REJECTED",
    "IN_TRANSIT",
    "ON_SITE",
    "CLOSE_REQUESTED",
    "CLOSED"
  ];
  if (allowed.includes(value as DispatchStatus)) {
    return value as DispatchStatus;
  }
  throw new ApiError(400, "Invalid status filter");
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const body = await readJson<z.infer<typeof createDispatchSchema>>(request);
    const input = createDispatchSchema.parse(body);

    if (input.reason === "OUTROS" && !input.reasonDetails) {
      throw new ApiError(400, "reasonDetails is required when reason=OUTROS");
    }

    const plate = normalizePlate(input.plate);
    if (!plate) {
      throw new ApiError(400, "Invalid plate");
    }

    const supplierCompanyIds = Array.from(new Set(input.supplierCompanyIds));
    if (supplierCompanyIds.length === 0) {
      throw new ApiError(400, "supplierCompanyIds cannot be empty");
    }

    const [suppliers, vehicle] = await Promise.all([
      prisma.supplierCompany.findMany({
        where: { id: { in: supplierCompanyIds }, isActive: true },
        select: { id: true }
      }),
      prisma.vehicle.findUnique({ where: { plate } })
    ]);

    if (suppliers.length !== supplierCompanyIds.length) {
      throw new ApiError(400, "One or more suppliers are invalid or inactive");
    }

    const vehicleModel = input.vehicleSnapshot?.model ?? vehicle?.model ?? null;
    const vehicleColor = input.vehicleSnapshot?.color ?? vehicle?.color ?? null;
    const vehicleYear = input.vehicleSnapshot?.year ?? vehicle?.year ?? null;

    const dispatch = await prisma.$transaction(async (tx) => {
      const created = await tx.dispatch.create({
        data: {
          status: "QUOTING",
          plate,
          vehicleId: vehicle?.id ?? null,
          vehicleModel,
          vehicleColor,
          vehicleYear,
          address: input.location.address,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          driverName: input.driverName,
          reason: input.reason as DispatchReason,
          reasonDetails: input.reasonDetails ?? null,
          createdById: user.id
        }
      });

      await tx.quote.createMany({
        data: supplierCompanyIds.map((supplierCompanyId) => ({
          dispatchId: created.id,
          supplierCompanyId
        }))
      });

      await tx.auditEvent.createMany({
        data: [
          {
            dispatchId: created.id,
            actorType: "USER",
            actorUserId: user.id,
            eventType: "DISPATCH_CREATED",
            payload: {
              plate,
              reason: input.reason,
              address: input.location.address
            }
          },
          {
            dispatchId: created.id,
            actorType: "USER",
            actorUserId: user.id,
            eventType: "QUOTES_CREATED",
            payload: { supplierCompanyIds }
          }
        ]
      });

      return created;
    });

    return jsonOk({ id: dispatch.id, status: dispatch.status }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const { searchParams } = new URL(request.url);
    const status = parseDispatchStatus(searchParams.get("status"));
    const supplierCompanyId = searchParams.get("supplierCompanyId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) {
      const parsed = new Date(from);
      if (Number.isNaN(parsed.getTime())) {
        throw new ApiError(400, "Invalid from date");
      }
      createdAt.gte = parsed;
    }
    if (to) {
      const parsed = new Date(to);
      if (Number.isNaN(parsed.getTime())) {
        throw new ApiError(400, "Invalid to date");
      }
      createdAt.lte = parsed;
    }

    const dispatches = await prisma.dispatch.findMany({
      where: {
        status: status ?? undefined,
        approvedSupplierCompanyId: supplierCompanyId ?? undefined,
        createdAt: Object.keys(createdAt).length ? createdAt : undefined
      },
      include: {
        approvedSupplierCompany: { select: { id: true, legalName: true } },
        approvedQuote: { select: { etaMinutes: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    return jsonOk(
      dispatches.map((dispatch) => ({
        id: dispatch.id,
        status: dispatch.status,
        createdAt: dispatch.createdAt,
        address: dispatch.address,
        reason: dispatch.reason,
        approvedSupplierCompany: dispatch.approvedSupplierCompany,
        approvedEtaMinutes: dispatch.approvedQuote?.etaMinutes ?? null
      }))
    );
  } catch (error) {
    return jsonError(error);
  }
}
