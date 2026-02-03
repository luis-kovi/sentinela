import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { emitToDispatch } from "@/lib/realtime";

interface RouteParams {
  params: { chatRoomId: string };
}

const postSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  attachmentIds: z.array(z.string().min(1)).optional()
});

function parseLimit(value: string | null): number {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

async function requireChatAccess(userId: string, role: string, supplierCompanyId: string | null, chatRoomId: string) {
  const chatRoom = await prisma.chatRoom.findUnique({
    where: { id: chatRoomId },
    include: { dispatch: { select: { id: true, approvedSupplierCompanyId: true } } }
  });

  if (!chatRoom) {
    throw new ApiError(404, "Chat room not found");
  }

  if (role === "SUPPLIER") {
    if (!supplierCompanyId || chatRoom.dispatch.approvedSupplierCompanyId !== supplierCompanyId) {
      throw new ApiError(403, "Forbidden");
    }
  }

  return chatRoom;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();

    const chatRoom = await requireChatAccess(
      user.id,
      user.role,
      user.supplierCompanyId ?? null,
      params.chatRoomId
    );

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const take = parseLimit(searchParams.get("limit"));

    const messages = await prisma.chatMessage.findMany({
      where: { chatRoomId: chatRoom.id },
      orderBy: { createdAt: "asc" },
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1
          }
        : {}),
      take: take + 1,
      include: {
        attachments: true,
        authorUser: { select: { id: true, name: true, role: true } },
        fieldSession: { select: { id: true } }
      }
    });

    const hasMore = messages.length > take;
    const items = hasMore ? messages.slice(0, take) : messages;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return jsonOk({ items, nextCursor });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireUser();

    const chatRoom = await requireChatAccess(
      user.id,
      user.role,
      user.supplierCompanyId ?? null,
      params.chatRoomId
    );

    const body = await readJson<z.infer<typeof postSchema>>(request);
    const input = postSchema.parse(body);

    const attachmentIds = input.attachmentIds ?? [];
    if (!input.text && attachmentIds.length === 0) {
      throw new ApiError(400, "Message must include text or attachments");
    }

    const result = await prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          chatRoomId: chatRoom.id,
          authorType: "USER",
          authorUserId: user.id,
          text: input.text ?? null
        }
      });

      if (attachmentIds.length > 0) {
        const updated = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            dispatchId: chatRoom.dispatchId,
            origin: "CHAT",
            chatMessageId: null
          },
          data: { chatMessageId: message.id }
        });

        if (updated.count !== attachmentIds.length) {
          throw new ApiError(400, "One or more attachments are invalid or already linked");
        }
      }

      return message;
    });

    emitToDispatch(chatRoom.dispatchId, "chat.messageNew", {
      chatRoomId: chatRoom.id,
      dispatchId: chatRoom.dispatchId,
      messageId: result.id
    });

    return jsonOk({ id: result.id, createdAt: result.createdAt });
  } catch (error) {
    return jsonError(error);
  }
}
