import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { createUploadUrl } from "@/lib/storage";
import { emitToDispatch } from "@/lib/realtime";
import { validateUploadByRole } from "@/lib/uploads";
import type { AttachmentOrigin, User } from "@prisma/client";

const presignSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(1),
  origin: z.enum(["CHAT", "COST_EVIDENCE"]),
  dispatchId: z.string().min(1),
  meta: z.record(z.unknown()).optional()
});

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createStorageKey(dispatchId: string, origin: AttachmentOrigin, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  const random = randomBytes(8).toString("hex");
  return `dispatch/${dispatchId}/${origin.toLowerCase()}/${Date.now()}-${random}-${safeName}`;
}

async function requireDispatchAccess(user: User, dispatchId: string) {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    select: { approvedSupplierCompanyId: true }
  });

  if (!dispatch) {
    throw new ApiError(404, "Dispatch not found");
  }

  if (user.role === "SUPPLIER") {
    if (!user.supplierCompanyId || dispatch.approvedSupplierCompanyId !== user.supplierCompanyId) {
      throw new ApiError(403, "Forbidden");
    }
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPPLIER") {
      requireRole(user, "KOVI");
    }

    const body = await readJson<z.infer<typeof presignSchema>>(request);
    const input = presignSchema.parse(body);

    await requireDispatchAccess(user, input.dispatchId);
    validateUploadByRole(input.fileName, input.mimeType, input.sizeBytes, user.role);

    const storageKey = createStorageKey(input.dispatchId, input.origin, input.fileName);
    const upload = await createUploadUrl({ key: storageKey, contentType: input.mimeType });

    const meta = input.meta ? { ...input.meta, mimeType: input.mimeType } : { mimeType: input.mimeType };

    const attachment = await prisma.attachment.create({
      data: {
        dispatchId: input.dispatchId,
        origin: input.origin,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        publicUrl: upload.publicUrl ?? null,
        meta
      }
    });

    emitToDispatch(input.dispatchId, "attachment.created", {
      dispatchId: input.dispatchId,
      attachmentId: attachment.id,
      origin: attachment.origin,
      fileName: attachment.fileName
    });

    return jsonOk({
      attachmentId: attachment.id,
      storageKey: attachment.storageKey,
      uploadUrl: upload.uploadUrl,
      headers: upload.headers,
      publicUrl: upload.publicUrl ?? null
    });
  } catch (error) {
    return jsonError(error);
  }
}
