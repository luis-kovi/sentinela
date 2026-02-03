"use client";

import { useEffect, useMemo, useState } from "react";
import { useDispatchRealtime } from "@/hooks/use-dispatch-realtime";

interface ChatMessage {
  id: string;
  text: string | null;
  authorType: string;
  createdAt: string;
  attachments?: {
    id: string;
    fileName: string;
    publicUrl?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    meta?: { width?: number; height?: number; mimeType?: string } | null;
  }[];
  authorUser?: { id: string; name: string; role: string } | null;
  systemType?: string | null;
}

interface FieldEventItem {
  type: string;
  occurredAt: string;
  meta?: Record<string, unknown> | null;
}

interface ApiMessageResponse {
  items: ChatMessage[];
  nextCursor: string | null;
}

interface DispatchPageProps {
  params: { dispatchId: string };
  searchParams: { userId?: string; chatRoomId?: string };
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => resolve({ width: image.width, height: image.height });
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = url;
    });
    URL.revokeObjectURL(url);
    return dimensions;
  } catch {
    return null;
  }
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export default function DispatchChatPage({ params, searchParams }: DispatchPageProps) {
  const userId = searchParams.userId ?? "";
  const chatRoomId = searchParams.chatRoomId ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<FieldEventItem[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoad = Boolean(userId && chatRoomId);

  const headers = useMemo(() => ({ "x-user-id": userId }), [userId]);

  const loadMessages = async () => {
    if (!canLoad) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/chats/${chatRoomId}/messages`, { headers });
      if (!response.ok) {
        throw new Error("Falha ao carregar mensagens");
      }
      const payload = (await response.json()) as ApiMessageResponse;
      setMessages(payload.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar mensagens");
    } finally {
      setLoading(false);
    }
  };

  const uploadAttachments = async (): Promise<{ attachmentIds: string[] }> => {
    if (files.length === 0) return { attachmentIds: [] };

    const attachmentIds: string[] = [];
    for (const file of files) {
      const meta: { width?: number; height?: number; mimeType?: string } = {
        mimeType: file.type || undefined
      };

      if (file.type.startsWith("image/")) {
        const dimensions = await getImageDimensions(file);
        if (dimensions) {
          meta.width = dimensions.width;
          meta.height = dimensions.height;
        }
      }

      const presignResponse = await fetch(`/api/v1/attachments/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          origin: "CHAT",
          dispatchId: params.dispatchId,
          meta
        })
      });

      if (!presignResponse.ok) {
        throw new Error("Falha ao preparar upload");
      }

      const presignPayload = (await presignResponse.json()) as {
        attachmentId: string;
        uploadUrl: string;
        headers: Record<string, string>;
        publicUrl: string | null;
      };

      const uploadResult = await fetch(presignPayload.uploadUrl, {
        method: "PUT",
        headers: presignPayload.headers,
        body: file
      });

      if (!uploadResult.ok) {
        throw new Error("Falha ao enviar arquivo");
      }

      attachmentIds.push(presignPayload.attachmentId);
    }

    return { attachmentIds };
  };

  const postMessage = async () => {
    if (!text.trim() && files.length === 0) return;
    try {
      setLoading(true);
      const uploadResult = await uploadAttachments();
      const attachmentIds = uploadResult.attachmentIds;
      const response = await fetch(`/api/v1/chats/${chatRoomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ text: text.trim() ? text : null, attachmentIds })
      });
      if (!response.ok) {
        throw new Error("Falha ao enviar mensagem");
      }
      setText("");
      setFiles([]);
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
  }, [chatRoomId, userId]);

  useDispatchRealtime({
    userId,
    dispatchId: params.dispatchId,
    enabled: canLoad,
    onChatMessageNew: () => void loadMessages(),
    onFieldEvent: (payload) => {
      setEvents((current) => [
        {
          type: (payload as { type?: string }).type ?? "EVENT",
          occurredAt: new Date().toISOString(),
          meta: payload as Record<string, unknown>
        },
        ...current
      ]);
    }
  });

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Chat do Acionamento</h1>
        <p style={{ margin: 0, color: "#555" }}>Dispatch: {params.dispatchId}</p>
      </header>

      {!canLoad && (
        <div style={{ padding: 16, background: "#fee", border: "1px solid #fbb" }}>
          Informe `userId` e `chatRoomId` na URL para testar. Ex:
          <code style={{ display: "block", marginTop: 8 }}>
            /dispatches/{params.dispatchId}?userId=USER_ID&amp;chatRoomId=CHAT_ID
          </code>
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#fee", border: "1px solid #fbb" }}>
          {error}
        </div>
      )}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Mensagens</h2>
        <div style={{ padding: 12, border: "1px solid #ddd", minHeight: 160 }}>
          {loading && <p>Carregando...</p>}
          {!loading && messages.length === 0 && <p>Nenhuma mensagem.</p>}
          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                {msg.authorType === "SYSTEM" ? "Sistema" : msg.authorUser?.name ?? "Usuário"} · {formatTime(msg.createdAt)}
              </div>
              {msg.systemType && <div style={{ fontStyle: "italic" }}>{msg.systemType}</div>}
              {msg.text && <div>{msg.text}</div>}
              {msg.attachments?.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                  {msg.attachments.map((att) => (
                    <li key={att.id}>
                      {(att.publicUrl && (att.meta?.mimeType ?? att.mimeType)?.startsWith("image/")) && (
                        <div style={{ marginBottom: 6 }}>
                          <img
                            src={att.publicUrl}
                            alt={att.fileName}
                            style={{
                              maxWidth: 180,
                              maxHeight: 120,
                              borderRadius: 6,
                              border: "1px solid #ddd",
                              display: "block"
                            }}
                            loading="lazy"
                          />
                        </div>
                      )}
                      {att.publicUrl ? (
                        <a href={att.publicUrl} target="_blank" rel="noreferrer">
                          {att.fileName}
                        </a>
                      ) : (
                        att.fileName
                      )}
                      {(att.meta?.mimeType || att.mimeType) && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
                          {(att.meta?.mimeType ?? att.mimeType) || ""}
                        </span>
                      )}
                      {att.meta?.width && att.meta?.height && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
                          {att.meta.width}x{att.meta.height}
                        </span>
                      )}
                      {typeof att.sizeBytes === "number" && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
                          {formatBytes(att.sizeBytes)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Digite sua mensagem"
            style={{ width: "100%", padding: 8 }}
          />
          <input
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          {files.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {files.map((file) => (
                <li key={file.name}>{file.name}</li>
              ))}
            </ul>
          )}
          <button onClick={postMessage} disabled={loading || (!text.trim() && files.length === 0)}>
            Enviar
          </button>
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Eventos do Campo</h2>
        <div style={{ padding: 12, border: "1px solid #ddd", minHeight: 120 }}>
          {events.length === 0 && <p>Nenhum evento recebido.</p>}
          {events.map((event, index) => (
            <div key={`${event.type}-${index}`} style={{ marginBottom: 8 }}>
              <strong>{event.type}</strong> · {formatTime(event.occurredAt)}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
