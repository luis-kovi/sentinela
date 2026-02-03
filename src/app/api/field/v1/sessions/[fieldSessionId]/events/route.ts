import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireFieldSession } from "@/lib/field";
import { ApiError } from "@/lib/errors";
import { emitToDispatch } from "@/lib/realtime";

interface RouteParams {
  params: { fieldSessionId: string };
}

const eventSchema = z.object({
  type: z.enum(["START_TRIP", "ARRIVE_ON_SITE", "REQUEST_CLOSE", "CLOSE"]),
  meta: z.record(z.unknown()).optional()
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("t") ?? "";
    const input = eventSchema.parse(await readJson(request));

    const fieldSession = await requireFieldSession(params.fieldSessionId, token);
    const dispatch = fieldSession.dispatch;

    if (dispatch.status === "REJECTED" || dispatch.status === "CLOSED") {
      throw new ApiError(409, "Dispatch is closed or rejected");
    }

    if (input.type === "CLOSE") {
      throw new ApiError(409, "Close is not allowed for field session");
    }

    const now = new Date();

    const { updatedSession, updatedDispatch } = await prisma.$transaction(async (tx) => {
      const sessionData: Record<string, Date | null | boolean> = {};
      const dispatchData: Record<string, Date | string | null> = {};
      let statusUpdate: string | null = null;
      let auditEventType: string | null = null;
      let systemType: string | null = null;

      if (input.type === "START_TRIP") {
        if (!fieldSession.startedAt) sessionData.startedAt = now;
        if (!dispatch.fieldStartedAt) dispatchData.fieldStartedAt = now;
        statusUpdate = "IN_TRANSIT";
        auditEventType = "FIELD_STARTED";
        systemType = "FIELD_STARTED";
      }

      if (input.type === "ARRIVE_ON_SITE") {
        if (!fieldSession.arrivedAt) sessionData.arrivedAt = now;
        if (!dispatch.fieldArrivedAt) dispatchData.fieldArrivedAt = now;
        statusUpdate = "ON_SITE";
        auditEventType = "FIELD_ARRIVED";
        systemType = "FIELD_ARRIVED";
      }

      if (input.type === "REQUEST_CLOSE") {
        if (!fieldSession.closeRequestedAt) sessionData.closeRequestedAt = now;
        statusUpdate = "CLOSE_REQUESTED";
        auditEventType = "FIELD_CLOSE_REQUESTED";
        systemType = "FIELD_CLOSE_REQUESTED";
      }

      if (statusUpdate) {
        dispatchData.status = statusUpdate;
      }

      const updatedSession = Object.keys(sessionData).length
        ? await tx.fieldSession.update({
            where: { id: fieldSession.id },
            data: sessionData
          })
        : fieldSession;

      const updatedDispatch = Object.keys(dispatchData).length
        ? await tx.dispatch.update({
            where: { id: dispatch.id },
            data: dispatchData
          })
        : dispatch;

      await tx.fieldEvent.create({
        data: {
          fieldSessionId: fieldSession.id,
          type: input.type,
          meta: input.meta ?? null,
          occurredAt: now
        }
      });

      if (auditEventType) {
        await tx.auditEvent.create({
          data: {
            dispatchId: dispatch.id,
            actorType: "FIELD_SESSION",
            actorFieldSessionId: fieldSession.id,
            eventType: auditEventType,
            payload: input.meta ?? null
          }
        });
      }

      if (systemType && dispatch.chatRoom) {
        await tx.chatMessage.create({
          data: {
            chatRoomId: dispatch.chatRoom.id,
            authorType: "SYSTEM",
            systemType
          }
        });
      }

      return { updatedSession, updatedDispatch };
    });

    emitToDispatch(dispatch.id, "field.event", {
      dispatchId: dispatch.id,
      fieldSessionId: fieldSession.id,
      type: input.type,
      occurredAt: now.toISOString(),
      meta: input.meta ?? null
    });

    if (updatedDispatch.status !== dispatch.status) {
      emitToDispatch(dispatch.id, "dispatch.statusChanged", {
        dispatchId: dispatch.id,
        from: dispatch.status,
        to: updatedDispatch.status
      });
    }

    return jsonOk({
      fieldSessionId: updatedSession.id,
      dispatchId: updatedDispatch.id,
      status: updatedDispatch.status
    });
  } catch (error) {
    return jsonError(error);
  }
}
