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

export async function createSession(
  persona?: string,
  wordbookTraining?: boolean,
  userId?: number,
  voiceprintVerification?: boolean,
): Promise<string> {
  const params = new URLSearchParams();
  if (persona) params.set("persona", persona);
  if (wordbookTraining) params.set("wordbook_training", "true");
  if (userId) params.set("user_id", String(userId));
  if (voiceprintVerification) params.set("voiceprint_verification", "true");
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
  voiceEnabled: boolean = true,
) {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message, voice_enabled: voiceEnabled }),
  });
  if (!res.ok) throw new Error(await res.text());
  await consumeSse(res, onEvent);
}

export async function streamVoice(
  sessionId: string,
  blob: Blob,
  filename: string,
  onEvent: SseHandler,
  voiceEnabled: boolean = true,
) {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", blob, filename);
  form.append("voice_enabled", String(voiceEnabled));
  const res = await fetch(`${API_BASE}/api/chat/voice`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  await consumeSse(res, onEvent);
}

export function callWsUrl(sessionId: string, video = false) {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = API_BASE ? new URL(API_BASE).host : loc.host;
  const videoParam = video ? "&video=1" : "";
  return `${proto}//${host}/api/call?session_id=${encodeURIComponent(sessionId)}${videoParam}`;
}

/**
 * 流式语音转文字 WebSocket URL
 */
export function sttStreamWsUrl() {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = API_BASE ? new URL(API_BASE).host : loc.host;
  return `${proto}//${host}/api/chat/stt-stream`;
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

/**
 * 语音转文字：上传音频 Blob，返回识别文本。
 * 用于输入框内语音识别图标——按住说话后转写为文字填入输入框。
 */
export async function sttTranscribe(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, filename);
  const res = await fetch(`${API_BASE}/api/chat/stt`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "STT failed");
  }
  const data = await res.json();
  return data.text as string;
}

export interface UserInfo {
  id: number;
  username: string;
  created_at: string;
}

/**
 * 用户登录（模拟登录，无需密码）
 */
export async function login(username: string): Promise<UserInfo> {
  const res = await fetch(`${API_BASE}/api/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Login failed");
  }
  return res.json();
}

/**
 * 获取用户信息
 */
export async function getUserInfo(username: string): Promise<UserInfo> {
  const res = await fetch(`${API_BASE}/api/users/me?username=${encodeURIComponent(username)}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to get user info");
  }
  return res.json();
}
