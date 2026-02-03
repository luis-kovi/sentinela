import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { emitToDispatch } from "@/lib/realtime";

interface RouteParams {
  params: { dispatchId: string };
}

const approveSchema = z.object({
  quoteId: z.string().min(1)
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const body = await readJson<z.infer<typeof approveSchema>>(request);
    const input = approveSchema.parse(body);

    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.dispatch.findUnique({
        where: { id: params.dispatchId },
        include: { approvedQuote: true }
      });

      if (!dispatch) {
        throw new ApiError(404, "Dispatch not found");
      }
      if (dispatch.status !== "QUOTING") {
        throw new ApiError(409, "Dispatch is not in QUOTING status");
      }

      const quote = await tx.quote.findUnique({ where: { id: input.quoteId } });
      if (!quote || quote.dispatchId !== dispatch.id) {
        throw new ApiError(404, "Quote not found for dispatch");
      }
      if (quote.status !== "SUBMITTED") {
        throw new ApiError(409, "Quote is not in SUBMITTED status");
      }

      const updatedDispatch = await tx.dispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "APPROVED",
          approvedQuoteId: quote.id,
          approvedSupplierCompanyId: quote.supplierCompanyId,
          approvedAt: new Date(),
          approvedById: user.id
        }
      });

      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "ACCEPTED" }
      });

      await tx.quote.updateMany({
        where: {
          dispatchId: dispatch.id,
          id: { not: quote.id }
        },
        data: { status: "REJECTED" }
      });

      const chatRoom = await tx.chatRoom.upsert({
        where: { dispatchId: dispatch.id },
        create: { dispatchId: dispatch.id },
        update: {}
      });

      await tx.auditEvent.createMany({
        data: [
          {
            dispatchId: dispatch.id,
            actorType: "USER",
            actorUserId: user.id,
            eventType: "DISPATCH_APPROVED",
            payload: { quoteId: quote.id }
          },
          {
            dispatchId: dispatch.id,
            actorType: "SYSTEM",
            eventType: "CHAT_CREATED",
            payload: { chatRoomId: chatRoom.id }
          }
        ]
      });

      return {
        dispatchId: updatedDispatch.id,
        status: updatedDispatch.status,
        chatRoomId: chatRoom.id,
        previousStatus: dispatch.status
      };
    });

    if (result.previousStatus !== result.status) {
      emitToDispatch(result.dispatchId, "dispatch.statusChanged", {
        dispatchId: result.dispatchId,
        from: result.previousStatus,
        to: result.status
      });
    }

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
