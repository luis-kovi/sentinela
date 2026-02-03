import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { hashToken } from "@/lib/field-token";

export async function requireFieldSession(fieldSessionId: string, token: string) {
  if (!token) {
    throw new ApiError(401, "Missing token");
  }

  const fieldSession = await prisma.fieldSession.findUnique({
    where: { id: fieldSessionId },
    include: {
      dispatch: {
        include: { chatRoom: { select: { id: true } } }
      }
    }
  });

  if (!fieldSession) {
    throw new ApiError(404, "Field session not found");
  }

  const tokenHash = hashToken(token);
  if (fieldSession.tokenHash !== tokenHash) {
    throw new ApiError(401, "Invalid token");
  }

  if (fieldSession.expiresAt && fieldSession.expiresAt.getTime() < Date.now()) {
    throw new ApiError(410, "Field session expired");
  }

  return fieldSession;
}

export async function requireFieldSessionByToken(token: string, dispatchId?: string) {
  if (!token) {
    throw new ApiError(401, "Missing token");
  }

  const tokenHash = hashToken(token);
  const fieldSession = await prisma.fieldSession.findUnique({
    where: { tokenHash },
    include: {
      dispatch: {
        include: { chatRoom: { select: { id: true } } }
      }
    }
  });

  if (!fieldSession) {
    throw new ApiError(404, "Field session not found");
  }

  if (dispatchId && fieldSession.dispatchId !== dispatchId) {
    throw new ApiError(403, "Dispatch mismatch");
  }

  if (fieldSession.expiresAt && fieldSession.expiresAt.getTime() < Date.now()) {
    throw new ApiError(410, "Field session expired");
  }

  return fieldSession;
}
