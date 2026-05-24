import { useRef, useState, useCallback } from "react";

interface Props {
  disabled?: boolean;
  isRecording: boolean;
  size?: "sm" | "lg";
  onStart: () => void;
  onStop: (action: "send" | "cancel" | "text") => void;
}

type Zone = "none" | "cancel" | "text";

export function VoiceHoldButton({ disabled, isRecording, size = "sm", onStart, onStop }: Props) {
  const [zone, setZone] = useState<Zone>("none");
  const initialXRef = useRef(0);
  const recordingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    initialXRef.current = e.clientX;
    recordingRef.current = true;
    setZone("none");
    onStart();
  }, [onStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!recordingRef.current) return;
    const offsetX = e.clientX - initialXRef.current;
    if (offsetX < -60) {
      setZone("cancel"); // 左滑 → 取消
    } else if (offsetX > 60) {
      setZone("text");   // 右滑 → 转文字
    } else {
      setZone("none");
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (!recordingRef.current) return;
    recordingRef.current = false;
    const offsetX = e.clientX - initialXRef.current;
    let action: "send" | "cancel" | "text" = "send";
    if (offsetX < -60) {
      action = "cancel"; // 左滑松开 → 取消
    } else if (offsetX > 60) {
      action = "text";   // 右滑松开 → 转文字
    }
    setZone("none");
    onStop(action);
  }, [onStop]);

  if (size === "sm") {
    return (
      <button
        type="button"
        disabled={disabled}
        className={`relative w-10 h-10 rounded-full border flex items-center justify-center text-lg disabled:opacity-40 select-none touch-none transition-all duration-150 ${
          isRecording
            ? "bg-[#ff4444] border-[#ff4444] text-white scale-110 shadow-lg shadow-red-300/50"
            : "bg-[#f5f5f5] border-[#ddd] active:scale-95"
        }`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={(e) => {
          if (e.buttons && !disabled) handlePointerUp(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
        title="按住说话"
      >
        {isRecording ? (
          <span className="relative z-10">
            <span className="inline-block w-2 h-2 bg-white rounded-full animate-ping absolute inset-0 m-auto" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        )}
        {isRecording && (
          <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-40" />
        )}
      </button>
    );
  }

  // size === "lg"
  return (
    <div className="relative flex-1">
      {/* 录音状态浮层：紧贴按钮上方，宽度几乎占满屏幕 */}
      {isRecording && (
        <div className="fixed inset-x-0 bottom-[52px] mb-3 max-w-lg mx-auto px-4 pointer-events-none z-50">
          {/* 取消 和 转文字 并排 */}
          <div className="flex gap-3 mb-2">
            {/* 取消（左侧） */}
            <div className={`flex-1 flex items-center justify-center gap-2 h-20 rounded-lg transition-all duration-200 ${
              zone === "cancel"
                ? "bg-[#ff4444] scale-105 shadow-lg shadow-red-400/40"
                : "bg-black/30"
            }`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              <span className="text-white text-[15px]">
                {zone === "cancel" ? "松开 取消" : "取消"}
              </span>
            </div>

            {/* 转文字（右侧） */}
            <div className={`flex-1 flex items-center justify-center gap-2 h-20 rounded-lg transition-all duration-200 ${
              zone === "text"
                ? "bg-[#07c160] scale-105 shadow-lg shadow-green-400/40"
                : "bg-black/30"
            }`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
              <span className="text-white text-[15px]">
                {zone === "text" ? "松开 转文字" : "转文字"}
              </span>
            </div>
          </div>

          {/* 波形动画 */}
          <div className="flex items-center justify-center gap-[3px]">
            {[4, 6, 8, 10, 8, 6, 4, 2].map((h, i) => (
              <span
                key={i}
                className="inline-block w-[3px] rounded-full bg-[#07c160] animate-wave"
                style={{ height: h, animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        className={`w-full h-9 rounded-md border text-[15px] font-normal select-none touch-none transition-all duration-150 ${
          isRecording
            ? "bg-[#c0c0c0] border-[#c0c0c0] text-white"
            : "bg-white border-[#d6d6d6] text-[#999] active:bg-[#e6e6e6]"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isRecording ? "松开 发送" : "按住 说话"}
      </button>
    </div>
  );
}
