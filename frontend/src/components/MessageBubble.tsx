import type { ChatMessage } from "../types/chat";

interface Props {
  message: ChatMessage;
  /** 是否正在播放该消息的语音 */
  isPlaying: boolean;
  /** 是否有本地缓存的音频可播放 */
  hasAudio: boolean;
  /** 点击播放回调 */
  onPlayVoice: () => void;
}

/** 模拟语音波形条，播放时带缩放动画 */
function VoiceWave({
  color,
  animating,
}: {
  color: string;
  animating: boolean;
}) {
  return (
    <span className="flex items-end gap-[1.5px] h-4">
      {[0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.8, 0.5, 0.4, 0.7, 0.6, 0.3].map(
        (h, i) => (
          <span
            key={i}
            className={`w-[2px] rounded-full ${animating ? "animate-voice-bar" : ""}`}
            style={{
              height: `${h * 100}%`,
              backgroundColor: color,
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ),
      )}
    </span>
  );
}

export function MessageBubble({
  message,
  isPlaying,
  hasAudio,
  onPlayVoice,
}: Props) {
  const isUser = message.role === "user";
  const isVoice = message.source === "voice" && isUser;
  const isAssistantWithAudio = !isUser && hasAudio;
  const dur = message.duration ?? 0;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 px-3`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-[15px] leading-relaxed shadow-sm ${
          isUser
            ? "bg-[#95ec69] text-[#111]"
            : "bg-white text-[#111] border border-[#e5e5e5]"
        } ${isVoice && hasAudio ? "cursor-pointer active:opacity-80" : ""}`}
      >
        {/* 智能体消息的语音条 — 在文字内容上方，独立可点击 */}
        {isAssistantWithAudio && (
          <div
            className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-[#e5e5e5] cursor-pointer active:opacity-80"
            onClick={onPlayVoice}
          >
            <span className="text-[11px] text-[#999] select-none">
              {isPlaying ? "⬤ 播放中" : "▶ 点击播放语音"}
            </span>
            <VoiceWave color={isPlaying ? "#07c160" : "#bbb"} animating={isPlaying} />
          </div>
        )}

        {isVoice ? (
          <div className="flex items-center gap-2 min-w-[80px]">
            <span className="text-xs text-[#666] tabular-nums min-w-[28px] text-right">
              {isPlaying ? (
                <span className="inline-block w-2 h-2 bg-[#07c160] rounded-full animate-pulse" />
              ) : dur > 0 ? (
                `${dur}″`
              ) : (
                "..."
              )}
            </span>
            <VoiceWave color="#07c160" animating={isPlaying} />
          </div>
        ) : (
          <>
            {message.content || (message.streaming ? "..." : "")}
            {message.streaming && (
              <span className="inline-block w-1 h-4 ml-0.5 bg-[#888] animate-pulse align-middle" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
