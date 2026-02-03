import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";

interface RouteParams {
  params: { dispatchId: string };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    const baseInclude = {
      approvedSupplierCompany: { select: { id: true, legalName: true } },
      approvedQuote: { select: { etaMinutes: true } },
      chatRoom: { select: { id: true } },
      cost: true
    } as const;

    const dispatch = await prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      include: user.role === "SUPPLIER" ? baseInclude : { ...baseInclude, quotes: true }
    });

    if (!dispatch) {
      throw new ApiError(404, "Dispatch not found");
    }

    if (user.role === "SUPPLIER") {
      if (!user.supplierCompanyId || dispatch.approvedSupplierCompanyId !== user.supplierCompanyId) {
        throw new ApiError(403, "Forbidden");
      }
    }

    return jsonOk(dispatch);
  } catch (error) {
    return jsonError(error);
  }
}
