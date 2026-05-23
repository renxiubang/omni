const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface AppConfig {
  output_sample_rate: number;
}

let _cachedConfig: AppConfig | null = null;

export async function fetchConfig(): Promise<AppConfig> {
  if (_cachedConfig) return _cachedConfig;
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  _cachedConfig = await res.json();
  return _cachedConfig!;
}

export async function createSession(persona?: string): Promise<string> {
  const params = new URLSearchParams();
  if (persona) params.set("persona", persona);
  const qs = params.toString();
  const url = `${API_BASE}/api/sessions${qs ? "?" + qs : ""}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.session_id as string;
}

export interface PersonaInfo {
  key: string;
  name: string;
  description: string;
  difficulty: string;
}

export async function listPersonas(): Promise<PersonaInfo[]> {
  const res = await fetch(`${API_BASE}/api/sessions/personas`);
  if (!res.ok) throw new Error("Failed to list personas");
  return res.json();
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

export interface TranslateResult {
  text: string;
  translation: string;
  source: string;
  target: string;
}

/**
 * 调用后端翻译 API（使用多模态大模型），将英文翻译为中文
 */
export async function translateToZh(text: string): Promise<TranslateResult> {
  const res = await fetch(`${API_BASE}/api/translate/to-zh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Translation failed");
  }
  return res.json();
}

export interface TtsRequest {
  text: string;
  voice?: string;
}

/**
 * 将文本合成为语音并流式返回 PCM16 base64 音频（SSE）。
 * 用于文本输入场景下，用户点击"播放语音"按钮后，
 * 流式合成并播放智能体回复的语音。
 * 不影响原有的语音输入 → 语音输出路径。
 */
export async function streamTts(
  body: TtsRequest,
  onEvent: SseHandler,
) {
  const res = await fetch(`${API_BASE}/api/chat/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  await consumeSse(res, onEvent);
}
