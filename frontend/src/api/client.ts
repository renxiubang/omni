const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.session_id as string;
}

export async function loadMessages(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error("Failed to load messages");
  return res.json();
}

export type SseHandler = (event: string, data: Record<string, unknown>) => void;

async function consumeSse(res: Response, onEvent: SseHandler) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const block of parts) {
      const lines = block.split("\n");
      eventName = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (dataLine) {
        try {
          onEvent(eventName, JSON.parse(dataLine));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: SseHandler,
) {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await res.text());
  await consumeSse(res, onEvent);
}

export async function streamVoice(
  sessionId: string,
  blob: Blob,
  filename: string,
  onEvent: SseHandler,
) {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", blob, filename);
  const res = await fetch(`${API_BASE}/api/chat/voice`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  await consumeSse(res, onEvent);
}

export function callWsUrl(sessionId: string) {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = API_BASE ? new URL(API_BASE).host : loc.host;
  return `${proto}//${host}/api/call?session_id=${encodeURIComponent(sessionId)}`;
}
