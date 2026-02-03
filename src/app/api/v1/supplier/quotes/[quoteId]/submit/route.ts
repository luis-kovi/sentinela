import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireSupplier, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { QUOTE_EXPIRES_MINUTES } from "@/lib/config";

interface RouteParams {
  params: { quoteId: string };
}

const submitSchema = z.object({
  etaMinutes: z.number().int().min(1).max(600),
  supplierNote: z.string().max(500).optional()
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireSupplier(user);

    const body = await readJson<z.infer<typeof submitSchema>>(request);
    const input = submitSchema.parse(body);

    const quote = await prisma.quote.findUnique({
      where: { id: params.quoteId },
      include: { dispatch: true }
    });

    if (!quote) {
      throw new ApiError(404, "Quote not found");
    }

    const expiresAt = new Date(quote.createdAt.getTime() + QUOTE_EXPIRES_MINUTES * 60000);
    if (Date.now() > expiresAt.getTime()) {
      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: "EXPIRED" }
      });
      throw new ApiError(409, "Quote expired");
    }
    if (quote.supplierCompanyId !== user.supplierCompanyId) {
      throw new ApiError(403, "Forbidden");
    }
    if (quote.status !== "PENDING") {
      throw new ApiError(409, "Quote is not in PENDING status");
    }
    if (quote.dispatch.status !== "QUOTING") {
      throw new ApiError(409, "Dispatch is not in QUOTING status");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: "SUBMITTED",
          etaMinutes: input.etaMinutes,
          supplierNote: input.supplierNote ?? null,
          submittedAt: new Date()
        }
      });

      await tx.auditEvent.create({
        data: {
          dispatchId: quote.dispatchId,
          actorType: "USER",
          actorUserId: user.id,
          eventType: "QUOTE_SUBMITTED",
          payload: { etaMinutes: input.etaMinutes, supplierCompanyId: quote.supplierCompanyId }
        }
      });

      return result;
    });

    return jsonOk({ id: updated.id, status: updated.status, etaMinutes: updated.etaMinutes });
  } catch (error) {
    return jsonError(error);
  }
}
