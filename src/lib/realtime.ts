import { Server } from "socket.io";

declare global {
  var io: Server | undefined;
}

export function emitToDispatch(dispatchId: string, event: string, payload: unknown) {
  const io = globalThis.io;
  if (!io) return;
  io.to(`dispatch:${dispatchId}`).emit(event, payload);
}
