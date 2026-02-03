import type { NextApiRequest } from "next";
import type { Server as HTTPServer } from "http";
import { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/rbac";

type NextApiResponseWithSocket = {
  socket: {
    server: HTTPServer & { io?: Server };
  };
};

const SOCKET_PATH = "/api/realtime";

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (res.socket.server.io) {
    res.end();
    return;
  }

  const io = new Server(res.socket.server, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  res.socket.server.io = io;
  (globalThis as { io?: Server }).io = io;

  io.use(async (socket, next) => {
    try {
      const userIdHeader = socket.handshake.headers["x-user-id"];
      const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : (userIdHeader as string | undefined);
      if (!userId) {
        return next(new Error("Missing x-user-id"));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, supplierCompanyId: true, isActive: true }
      });

      if (!user || !user.isActive) {
        return next(new Error("Invalid user"));
      }

      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error("Auth error"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("joinDispatch", async (payload: { dispatchId: string }, ack?: (result: unknown) => void) => {
      try {
        const user = socket.data.user as {
          id: string;
          role: "KOVI" | "SUPPLIER" | "ADMIN";
          supplierCompanyId: string | null;
        };

        if (!payload?.dispatchId) {
          throw new Error("Missing dispatchId");
        }

        if (user.role === "SUPPLIER") {
          const dispatch = await prisma.dispatch.findUnique({
            where: { id: payload.dispatchId },
            select: { approvedSupplierCompanyId: true }
          });

          if (!dispatch || dispatch.approvedSupplierCompanyId !== user.supplierCompanyId) {
            throw new Error("Forbidden");
          }
        } else if (!hasRole(user.role, "KOVI")) {
          throw new Error("Forbidden");
        }

        socket.join(`dispatch:${payload.dispatchId}`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Join error" });
      }
    });

    socket.on("leaveDispatch", (payload: { dispatchId: string }) => {
      if (payload?.dispatchId) {
        socket.leave(`dispatch:${payload.dispatchId}`);
      }
    });
  });

  res.end();
}
