export type MessageSource = "text" | "voice" | "call";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source: MessageSource;
  streaming?: boolean;
}
