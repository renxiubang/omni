import type { ChatMessage } from "../types/chat";

interface Props {
  message: ChatMessage;
  /** 是否正在播放该消息的语音（WAV 回放） */
  isPlaying: boolean;
  /** 是否有本地缓存的完整音频可播放 */
  hasAudio: boolean;
  /** 是否正在流式播放（PcmPlayer 实时播放中） */
  isStreamingPlaying?: boolean;
  /** 是否有正在收集的流式音频数据（语音条应保持可见） */
  hasStreamingData?: boolean;
  /** 点击播放回调 */
  onPlayVoice: () => void;
  /** 是否显示翻译 */
  showTranslation?: boolean;
  /** 翻译加载中 */
  translationLoading?: boolean;
  /** 点击翻译按钮回调 */
  onToggleTranslation?: () => void;
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
  isStreamingPlaying,
  hasStreamingData,
  onPlayVoice,
  showTranslation,
  translationLoading,
  onToggleTranslation,
}: Props) {
  const isUser = message.role === "user";
  const isVoice = (message.source === "voice" || message.source === "call") && isUser;
  const isAssistant = message.role === "assistant";
  const isCallRecord = message.source === "call" && message.role === "system";
  const dur = message.duration ?? 0;

  /** 是否显示智能体语音条：有音频 或 正在流式播放 或 有收集中的流式数据 */
  const showAudio = isAssistant && (hasAudio || isStreamingPlaying || hasStreamingData);
  /** 是否显示智能体顶栏：有音频 或 有翻译功能（始终对 assistant 开放翻译） */
  const showAssistantBar = isAssistant && (showAudio || !!onToggleTranslation);

  // 通话记录消息：居中胶囊样式
  if (isCallRecord) {
    return (
      <div className="flex justify-center my-3 px-3">
        <span className="text-xs text-[#999] bg-[#f0f0f0] rounded-full px-4 py-1.5 inline-flex items-center gap-1">
          📞 {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 px-3`}>
      <div
        data-message-content="true"
        className={`max-w-[75%] rounded-lg px-3 py-2 text-[15px] leading-relaxed shadow-sm ${
          isUser
            ? "bg-[#95ec69] text-[#111]"
            : "bg-white text-[#111] border border-[#e5e5e5]"
        } ${isVoice && hasAudio ? "cursor-pointer active:opacity-80" : ""}`}
        onClick={(isVoice && hasAudio) ? onPlayVoice : undefined}
      >
        {/* 智能体消息的顶栏 — 语音控件（有音频时） + 翻译按钮（始终） */}
        {showAssistantBar && (
          <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-[#e5e5e5]">
            {showAudio && (
              <div
                className="flex items-center gap-2 flex-1 cursor-pointer active:opacity-80"
                onClick={onPlayVoice}
              >
                <span className="text-[11px] text-[#999] select-none min-w-[70px]">
                  {isStreamingPlaying && "⬤ 正在播放"}
                  {!isStreamingPlaying && (isPlaying ? "⬤ 播放中" : "▶ 点击播放语音")}
                </span>
                <VoiceWave
                  color={isStreamingPlaying || isPlaying ? "#07c160" : "#bbb"}
                  animating={isStreamingPlaying || isPlaying}
                />
              </div>
            )}
            {/* 翻译按钮 — 无论有无音频始终右上 */}
            {onToggleTranslation && (
              <div className="ml-auto">
                <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTranslation();
                }}
                className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded select-none transition-colors ${
                  showTranslation
                    ? "bg-[#07c160] text-white"
                    : "bg-[#f0f0f0] text-[#666] hover:bg-[#e5e5e5]"
                }`}
                disabled={translationLoading}
              >
                {translationLoading ? "译中..." : "译"}
              </button>
              </div>
            )}
          </div>
        )}

        {isVoice ? (
          <>
            {message.speakerName && (
              <div className="text-[11px] text-[#07c160] mb-1 font-medium">
                {message.speakerName}
              </div>
            )}
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
          </>
        ) : (
          <>
            {message.content || (message.streaming ? "..." : "")}
            {message.streaming && (
              <span className="inline-block w-1 h-4 ml-0.5 bg-[#888] animate-pulse align-middle" />
            )}
            {/* 翻译内容显示 */}
            {showTranslation && message.translation && (
              <div className="mt-2 pt-2 border-t border-[#e5e5e5] text-[14px] leading-relaxed text-[#666]">
                {message.translation}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
