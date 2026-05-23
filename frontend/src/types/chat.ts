export type MessageSource = "text" | "voice" | "call";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source: MessageSource;
  streaming?: boolean;
  /** 语音消息时长（秒），仅 source === "voice" 时有效 */
  duration?: number;
}
