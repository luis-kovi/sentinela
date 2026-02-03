"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket, disconnectSocket } from "@/lib/socket";

export interface DispatchRealtimeEvents {
  onChatMessageNew?: (payload: unknown) => void;
  onFieldEvent?: (payload: unknown) => void;
  onDispatchStatusChanged?: (payload: unknown) => void;
  onAttachmentCreated?: (payload: unknown) => void;
}

interface UseDispatchRealtimeOptions extends DispatchRealtimeEvents {
  userId: string;
  dispatchId: string;
  enabled?: boolean;
}

export function useDispatchRealtime(options: UseDispatchRealtimeOptions) {
  const { userId, dispatchId, enabled = true } = options;
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const handlers = useMemo(
    () => ({
      chat: options.onChatMessageNew,
      field: options.onFieldEvent,
      status: options.onDispatchStatusChanged,
      attachment: options.onAttachmentCreated
    }),
    [
      options.onChatMessageNew,
      options.onFieldEvent,
      options.onDispatchStatusChanged,
      options.onAttachmentCreated
    ]
  );

  useEffect(() => {
    if (!enabled || !userId || !dispatchId) return;

    const socket = getSocket(userId);
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      socket.emit("joinDispatch", { dispatchId }, (ack: { ok?: boolean }) => {
        if (!ack?.ok) {
          console.warn("joinDispatch failed", ack);
        }
      });
    };

    const handleDisconnect = () => setConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    const onChat = (payload: unknown) => handlers.chat?.(payload);
    const onField = (payload: unknown) => handlers.field?.(payload);
    const onStatus = (payload: unknown) => handlers.status?.(payload);
    const onAttachment = (payload: unknown) => handlers.attachment?.(payload);

    socket.on("chat.messageNew", onChat);
    socket.on("field.event", onField);
    socket.on("dispatch.statusChanged", onStatus);
    socket.on("attachment.created", onAttachment);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.emit("leaveDispatch", { dispatchId });
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("chat.messageNew", onChat);
      socket.off("field.event", onField);
      socket.off("dispatch.statusChanged", onStatus);
      socket.off("attachment.created", onAttachment);
    };
  }, [dispatchId, enabled, userId, handlers]);

  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, []);

  return { connected };
}
