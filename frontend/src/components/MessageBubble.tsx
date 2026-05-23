import type { ChatMessage } from "../types/chat";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 px-3`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-[15px] leading-relaxed shadow-sm ${
          isUser
            ? "bg-[#95ec69] text-[#111]"
            : "bg-white text-[#111] border border-[#e5e5e5]"
        }`}
      >
        {message.content || (message.streaming ? "..." : "")}
        {message.streaming && (
          <span className="inline-block w-1 h-4 ml-0.5 bg-[#888] animate-pulse align-middle" />
        )}
        {message.source === "voice" && isUser && (
          <div className="text-[11px] text-[#666] mt-1">语音消息</div>
        )}
      </div>
    </div>
  );
}
