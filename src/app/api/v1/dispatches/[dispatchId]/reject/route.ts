import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { emitToDispatch } from "@/lib/realtime";

interface RouteParams {
  params: { dispatchId: string };
}

const rejectSchema = z.object({
  reason: z.string().min(3)
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const body = await readJson<z.infer<typeof rejectSchema>>(request);
    const input = rejectSchema.parse(body);

    const dispatch = await prisma.dispatch.findUnique({ where: { id: params.dispatchId } });
    if (!dispatch) {
      throw new ApiError(404, "Dispatch not found");
    }
    if (dispatch.status !== "QUOTING") {
      throw new ApiError(409, "Dispatch is not in QUOTING status");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.dispatch.update({
        where: { id: params.dispatchId },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedById: user.id,
          rejectReason: input.reason
        }
      });

      await tx.auditEvent.create({
        data: {
          dispatchId: params.dispatchId,
          actorType: "USER",
          actorUserId: user.id,
          eventType: "DISPATCH_REJECTED",
          payload: { reason: input.reason }
        }
      });

      return result;
    });

    emitToDispatch(updated.id, "dispatch.statusChanged", {
      dispatchId: updated.id,
      from: "QUOTING",
      to: updated.status
    });

    return jsonOk({ id: updated.id, status: updated.status });
  } catch (error) {
    return jsonError(error);
  }
}
