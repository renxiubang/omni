import type { ChatMessage } from "../types/chat";
import { MessageBubble } from "./MessageBubble";
import { useEffect, useRef } from "react";

interface Props {
  messages: ChatMessage[];
  playingVoiceId: string | null;
  audioAvailableIds: Set<string>;
  onPlayVoice: (id: string) => void;
}

export function MessageList({ messages, playingVoiceId, audioAvailableIds, onPlayVoice }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isPlaying={playingVoiceId === m.id}
          hasAudio={audioAvailableIds.has(m.id)}
          onPlayVoice={() => onPlayVoice(m.id)}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
