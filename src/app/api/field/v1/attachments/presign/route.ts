import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireFieldSessionByToken } from "@/lib/field";
import { createUploadUrl } from "@/lib/storage";
import { emitToDispatch } from "@/lib/realtime";
import { validateUploadByRole } from "@/lib/uploads";

const presignSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(1),
  dispatchId: z.string().min(1),
  meta: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      mimeType: z.string().optional()
    })
    .passthrough()
    .optional()
});

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("t") ?? "";
    const input = presignSchema.parse(await readJson(request));

    const fieldSession = await requireFieldSessionByToken(token, input.dispatchId);

    validateUploadByRole(input.fileName, input.mimeType, input.sizeBytes, "FIELD", "FIELD", input.meta);

    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `dispatch/${input.dispatchId}/field/${Date.now()}-${safeFileName}`;

    const upload = await createUploadUrl({ key: storageKey, contentType: input.mimeType });

    const result = await prisma.$transaction(async (tx) => {
      const meta = input.meta ? { ...input.meta, mimeType: input.mimeType } : { mimeType: input.mimeType };

      const attachment = await tx.attachment.create({
        data: {
          dispatchId: input.dispatchId,
          origin: "FIELD",
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey,
          publicUrl: upload.publicUrl ?? null,
          meta
        }
      });

      const chatRoom = await tx.chatRoom.findUnique({ where: { dispatchId: input.dispatchId } });
      if (chatRoom) {
        const chatMessage = await tx.chatMessage.create({
          data: {
            chatRoomId: chatRoom.id,
            authorType: "FIELD",
            fieldSessionId: fieldSession.id
          }
        });

        await tx.attachment.update({
          where: { id: attachment.id },
          data: { chatMessageId: chatMessage.id }
        });
      }

      return attachment;
    });

    emitToDispatch(input.dispatchId, "attachment.created", {
      dispatchId: input.dispatchId,
      attachmentId: result.id,
      origin: result.origin,
      fileName: result.fileName
    });

    return jsonOk({
      attachmentId: result.id,
      storageKey: result.storageKey,
      uploadUrl: upload.uploadUrl,
      headers: upload.headers,
      publicUrl: upload.publicUrl ?? null
    });
  } catch (error) {
    return jsonError(error);
  }
}
