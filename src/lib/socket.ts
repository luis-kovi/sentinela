"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

function getBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function getSocket(userId: string): Socket {
  if (!socket) {
    socket = io(getBaseUrl(), {
      path: "/api/realtime",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      extraHeaders: { "x-user-id": userId }
    });
  }

  if (socket.disconnected) {
    socket.connect();
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
