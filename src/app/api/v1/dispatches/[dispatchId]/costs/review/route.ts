import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { emitToDispatch } from "@/lib/realtime";

interface RouteParams {
  params: { dispatchId: string };
}

const reviewSchema = z.object({
  approve: z.boolean(),
  reviewNote: z.string().max(1000).optional(),
  forceClose: z.boolean().optional()
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const body = await readJson<z.infer<typeof reviewSchema>>(request);
    const input = reviewSchema.parse(body);

    const dispatch = await prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      include: { cost: true }
    });

    if (!dispatch) {
      throw new ApiError(404, "Dispatch not found");
    }

    if (!dispatch.cost) {
      throw new ApiError(409, "Costs not submitted for dispatch");
    }

    if (dispatch.status === "REJECTED" || dispatch.status === "CLOSED") {
      throw new ApiError(409, "Dispatch is closed or rejected");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedCost = await tx.costBreakdown.update({
        where: { dispatchId: dispatch.id },
        data: {
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
          validationNotes: input.reviewNote ?? dispatch.cost?.validationNotes ?? null
        }
      });

      let updatedDispatch = dispatch;
      if (input.approve && (input.forceClose ?? true)) {
        updatedDispatch = await tx.dispatch.update({
          where: { id: dispatch.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closedById: user.id
          }
        });
      }

      await tx.auditEvent.createMany({
        data: [
          {
            dispatchId: dispatch.id,
            actorType: "USER",
            actorUserId: user.id,
            eventType: "COST_REVIEWED",
            payload: { approve: input.approve, reviewNote: input.reviewNote ?? null }
          },
          ...(input.approve && (input.forceClose ?? true)
            ? [
                {
                  dispatchId: dispatch.id,
                  actorType: "USER",
                  actorUserId: user.id,
                  eventType: "DISPATCH_CLOSED"
                }
              ]
            : [])
        ]
      });

      return { updatedCost, updatedDispatch };
    });

    if (result.updatedDispatch.status !== dispatch.status) {
      emitToDispatch(dispatch.id, "dispatch.statusChanged", {
        dispatchId: dispatch.id,
        from: dispatch.status,
        to: result.updatedDispatch.status
      });
    }

    return jsonOk({
      dispatchId: dispatch.id,
      status: result.updatedDispatch.status,
      reviewedAt: result.updatedCost.reviewedAt
    });
  } catch (error) {
    return jsonError(error);
  }
}
