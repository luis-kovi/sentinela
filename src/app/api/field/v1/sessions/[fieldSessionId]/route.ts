import { jsonError, jsonOk } from "@/lib/http";
import { requireFieldSession } from "@/lib/field";

interface RouteParams {
  params: { fieldSessionId: string };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("t") ?? "";

    const fieldSession = await requireFieldSession(params.fieldSessionId, token);
    const dispatch = fieldSession.dispatch;

    return jsonOk({
      fieldSessionId: fieldSession.id,
      dispatchId: dispatch.id,
      address: dispatch.address,
      latitude: dispatch.latitude ? Number(dispatch.latitude) : null,
      longitude: dispatch.longitude ? Number(dispatch.longitude) : null,
      allowClose: fieldSession.allowClose,
      expiresAt: fieldSession.expiresAt
    });
  } catch (error) {
    return jsonError(error);
  }
}
