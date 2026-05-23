import type { ChatMessage } from "../types/chat";
import { MessageBubble } from "./MessageBubble";
import { useEffect, useRef } from "react";

interface Props {
  messages: ChatMessage[];
  playingVoiceId: string | null;
  audioAvailableIds: Set<string>;
  /** 正在流式播放音频的消息 ID（null 表示未在流式播放或已中止） */
  streamingAudioId: string | null;
  /** 有未完成的流式音频数据的消息 ID 集合（用于保持语音条可见） */
  streamingDataIds: Set<string>;
  onPlayVoice: (id: string) => void;
}

export function MessageList({
  messages,
  playingVoiceId,
  audioAvailableIds,
  streamingAudioId,
  streamingDataIds,
  onPlayVoice,
}: Props) {
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
          isStreamingPlaying={streamingAudioId === m.id}
          hasStreamingData={streamingDataIds.has(m.id)}
          onPlayVoice={() => onPlayVoice(m.id)}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
