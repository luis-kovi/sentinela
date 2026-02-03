import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireFieldSession } from "@/lib/field";

interface RouteParams {
  params: { fieldSessionId: string };
}

const gpsSchema = z.object({
  points: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().int().optional(),
        speedMps: z.number().optional(),
        recordedAt: z.string().datetime()
      })
    )
    .min(1)
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("t") ?? "";
    const input = gpsSchema.parse(await readJson(request));

    const fieldSession = await requireFieldSession(params.fieldSessionId, token);

    await prisma.gPSPoint.createMany({
      data: input.points.map((point) => ({
        fieldSessionId: fieldSession.id,
        latitude: point.lat.toString(),
        longitude: point.lng.toString(),
        accuracyM: point.accuracyM ?? null,
        speedMps: point.speedMps ?? null,
        recordedAt: new Date(point.recordedAt)
      }))
    });

    return jsonOk({ inserted: input.points.length });
  } catch (error) {
    return jsonError(error);
  }
}
