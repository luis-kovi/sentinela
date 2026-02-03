import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireRole, requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { createFieldToken } from "@/lib/field-token";
import { FIELD_SESSION_EXPIRES_MINUTES } from "@/lib/config";

interface RouteParams {
  params: { dispatchId: string };
}

const createSchema = z.object({
  expiresInMinutes: z.number().int().min(5).max(24 * 60).optional(),
  allowClose: z.boolean().optional()
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();
    requireRole(user, "KOVI");

    const body = await readJson<z.infer<typeof createSchema>>(request);
    const input = createSchema.parse(body);

    if (input.allowClose) {
      throw new ApiError(400, "Field session cannot allow close (policy)");
    }

    const dispatch = await prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      include: { approvedSupplierCompany: true }
    });

    if (!dispatch) {
      throw new ApiError(404, "Dispatch not found");
    }

    if (!dispatch.approvedSupplierCompanyId) {
      throw new ApiError(409, "Dispatch has no approved supplier");
    }

    if (dispatch.status === "REJECTED" || dispatch.status === "CLOSED") {
      throw new ApiError(409, "Dispatch is closed or rejected");
    }

    const expiresInMinutes = input.expiresInMinutes ?? FIELD_SESSION_EXPIRES_MINUTES;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);

    const { token, tokenHash } = createFieldToken();

    const fieldSession = await prisma.$transaction(async (tx) => {
      const created = await tx.fieldSession.create({
        data: {
          dispatchId: dispatch.id,
          tokenHash,
          expiresAt,
          allowClose: false
        }
      });

      await tx.auditEvent.create({
        data: {
          dispatchId: dispatch.id,
          actorType: "USER",
          actorUserId: user.id,
          eventType: "FIELD_SESSION_CREATED",
          payload: { fieldSessionId: created.id, expiresAt }
        }
      });

      return created;
    });

    const baseUrl = process.env.FIELD_LINK_BASE_URL || "";
    const fieldUrl = `${baseUrl}/field/${fieldSession.id}?t=${token}`;

    return jsonOk({ fieldSessionId: fieldSession.id, fieldUrl, expiresAt: fieldSession.expiresAt });
  } catch (error) {
    return jsonError(error);
  }
}
