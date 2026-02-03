import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import type { User } from "@prisma/client";

interface RouteParams {
  params: { attachmentId: string };
}

const confirmSchema = z.object({
  publicUrl: z.string().url().optional(),
  meta: z.record(z.unknown()).optional()
});

async function requireDispatchAccess(user: User, dispatchId: string | null) {
  if (!dispatchId) {
    throw new ApiError(400, "Attachment missing dispatchId");
  }

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

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPPLIER") {
      requireRole(user, "KOVI");
    }

    const body = await readJson<z.infer<typeof confirmSchema>>(request);
    const input = confirmSchema.parse(body);

    const attachment = await prisma.attachment.findUnique({
      where: { id: params.attachmentId }
    });

    if (!attachment) {
      throw new ApiError(404, "Attachment not found");
    }

    await requireDispatchAccess(user, attachment.dispatchId);

    const updated = await prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        publicUrl: input.publicUrl ?? attachment.publicUrl ?? null,
        meta: input.meta ?? attachment.meta ?? undefined
      }
    });

    return jsonOk({ id: updated.id, publicUrl: updated.publicUrl });
  } catch (error) {
    return jsonError(error);
  }
}
