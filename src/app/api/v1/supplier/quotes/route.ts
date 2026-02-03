import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireSupplier, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import type { QuoteStatus } from "@prisma/client";

function parseStatus(value: string | null): QuoteStatus[] {
  if (!value) {
    return ["PENDING", "SUBMITTED"];
  }

  const allowed: QuoteStatus[] = ["PENDING", "SUBMITTED"];
  if (!allowed.includes(value as QuoteStatus)) {
    throw new ApiError(400, "Invalid status filter");
  }
  return [value as QuoteStatus];
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    requireSupplier(user);

    const { searchParams } = new URL(request.url);
    const statuses = parseStatus(searchParams.get("status"));

    const quotes = await prisma.quote.findMany({
      where: {
        supplierCompanyId: user.supplierCompanyId ?? undefined,
        status: { in: statuses }
      },
      include: {
        dispatch: {
          select: {
            id: true,
            address: true,
            reason: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return jsonOk(
      quotes.map((quote) => ({
        quoteId: quote.id,
        dispatchId: quote.dispatchId,
        address: quote.dispatch.address,
        reason: quote.dispatch.reason,
        status: quote.status,
        createdAt: quote.createdAt
      }))
    );
  } catch (error) {
    return jsonError(error);
  }
}
