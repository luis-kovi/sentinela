import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";

interface RouteParams {
  params: { dispatchId: string };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const quotes = await prisma.quote.findMany({
      where: { dispatchId: params.dispatchId },
      include: {
        supplierCompany: { select: { id: true, legalName: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    return jsonOk(quotes);
  } catch (error) {
    return jsonError(error);
  }
}
