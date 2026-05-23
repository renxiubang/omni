import { useRef, useState, useCallback, useEffect } from "react";
import { VoiceHoldButton } from "./VoiceHoldButton";
import { sttTranscribe } from "../api/client";

type InputMode = "text" | "voice";

interface Props {
  disabled?: boolean;
  isRecording: boolean;
  onSendText: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: (action: "send" | "cancel" | "text") => void;
  onCall: () => void;
  onSttError?: (msg: string) => void;
  /** 外部传入的语音转文字结果，填入输入框 */
  voiceTextResult?: string | null;
  /** voiceTextResult 被消费后的回调 */
  onVoiceTextConsumed?: () => void;
}

export function Composer({
  disabled,
  isRecording,
  onSendText,
  onVoiceStart,
  onVoiceStop,
  onCall,
  onSttError,
  voiceTextResult,
  onVoiceTextConsumed,
}: Props) {
  const [mode, setMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  /** 语音转文字状态：idle | recording | loading */
  const [sttState, setSttState] = useState<"idle" | "recording" | "loading">("idle");
  const sttRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<Blob[]>([]);
  const sttPressedRef = useRef(false);
  const sttStartTimeRef = useRef(0);

  /** 最小录音时长（毫秒），小于此值提示用户 */
  const MIN_STT_DURATION_MS = 500;

  /** 外部语音转文字结果：填入输入框并切换到文字模式 */
  useEffect(() => {
    if (voiceTextResult) {
      setText(voiceTextResult);
      setMode("text");
      onVoiceTextConsumed?.();
    }
  }, [voiceTextResult]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSendText(t);
    setText("");
  };

  const toggleMode = () => {
    setMode((prev) => (prev === "text" ? "voice" : "text"));
  };

  /* ---- 语音转文字（输入框内 🎤 图标） ---- */
  const startStt = useCallback(async () => {
    if (disabled || sttState !== "idle") return;
    sttPressedRef.current = true;
    setSttState("recording");
    sttChunksRef.current = [];
    sttStartTimeRef.current = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sttPressedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setSttState("idle");
        return;
      }

      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          sttChunksRef.current.push(e.data);
        }
      };
      rec.onerror = () => {
        console.error("[STT] MediaRecorder error");
        rec.stream.getTracks().forEach((t) => t.stop());
        setSttState("idle");
        onSttError?.("录音失败，请重试");
      };
      sttRecorderRef.current = rec;
      rec.start(100); // 每 100ms 捕获一次数据，确保短录音也能获取音频
    } catch (err) {
      console.error("[STT] Failed to start:", err);
      setSttState("idle");
      onSttError?.("无法访问麦克风，请检查权限");
    }
  }, [disabled, sttState, onSttError]);

  const stopStt = useCallback(() => {
    sttPressedRef.current = false;
    const rec = sttRecorderRef.current;
    sttRecorderRef.current = null;

    if (!rec) {
      setSttState("idle");
      return;
    }

    // 检查录音时长
    const duration = Date.now() - sttStartTimeRef.current;
    if (duration < MIN_STT_DURATION_MS) {
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
      setSttState("idle");
      onSttError?.("录音时间太短，请长按说话");
      return;
    }

    setSttState("loading");

    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());

      const chunks = sttChunksRef.current;
      if (chunks.length === 0) {
        console.warn("[STT] No audio chunks captured");
        setSttState("idle");
        onSttError?.("未检测到音频，请重试");
        return;
      }

      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      console.log("[STT] Blob size:", blob.size, "type:", blob.type);

      if (blob.size < 2000) {
        console.warn("[STT] Audio too short, size:", blob.size);
        setSttState("idle");
        onSttError?.("录音时间太短，请长按说话");
        return;
      }

      const ext = rec.mimeType?.includes("webm") ? "recording.webm" : "recording.wav";

      try {
        const result = await sttTranscribe(blob, ext);
        if (result && result.trim()) {
          setText((prev) => (prev ? prev + result : result));
        } else {
          onSttError?.("未能识别语音，请重试");
        }
      } catch (e) {
        console.error("[STT] Transcription failed:", e);
        onSttError?.("语音识别失败，请重试");
      } finally {
        setSttState("idle");
      }
    };

    rec.stop();
  }, [onSttError]);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#f7f7f7] border-t border-[#ddd]">
      {/* 最左侧：通话按钮 */}
      <button
        type="button"
        className="w-10 h-10 rounded-full bg-[#f5f5f5] flex items-center justify-center text-lg disabled:opacity-40 select-none transition-colors hover:bg-[#e0e0e0]"
        onClick={onCall}
        disabled={disabled}
        title="通话"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>

      {/* 模式切换按钮 */}
      <button
        type="button"
        disabled={disabled}
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg disabled:opacity-40 select-none transition-colors hover:bg-[#e0e0e0]"
        onClick={toggleMode}
        title={mode === "text" ? "切换到语音" : "切换到文字"}
      >
        {mode === "text" ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M6 8h2M10 8h4M16 8h2M6 12h2M10 12h4M6 16h12"/>
          </svg>
        )}
      </button>

      {/* 文字模式 */}
      {mode === "text" && (
        <>
          {/* 输入框（相对定位，用于放置右侧语音识别图标） */}
          <div className="relative flex-1">
            <input
              className="w-full h-9 rounded-md border border-[#ddd] px-3 pr-9 text-[15px] bg-white outline-none focus:border-[#07c160] disabled:bg-[#f5f5f5]"
              placeholder={
                sttState === "recording" ? "正在聆听..." :
                sttState === "loading" ? "识别中..." :
                "输入消息..."
              }
              value={text}
              disabled={disabled || sttState !== "idle"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {/* 输入框内右侧语音识别图标 */}
            <button
              type="button"
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                sttState === "recording"
                  ? "bg-[#07c160]"
                  : "hover:bg-[#f0f0f0]"
              }`}
              onPointerDown={(e) => {
                e.preventDefault();
                startStt();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                stopStt();
              }}
              onPointerLeave={(e) => {
                if (e.buttons) stopStt();
              }}
              onContextMenu={(e) => e.preventDefault()}
              title="语音转文字（按住说话）"
              disabled={disabled || sttState === "loading"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sttState === "recording" ? "white" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          </div>

          {/* 发送按钮 */}
          <button
            type="button"
            className="h-9 px-4 rounded-md bg-[#07c160] text-white text-[15px] disabled:opacity-40 transition-colors"
            disabled={disabled || !text.trim() || sttState !== "idle"}
            onClick={submit}
          >
            发送
          </button>
        </>
      )}

      {/* 语音模式：按住说话按钮（仿微信风格） */}
      {mode === "voice" && (
        <VoiceHoldButton
          disabled={disabled}
          isRecording={isRecording}
          size="lg"
          onStart={onVoiceStart}
          onStop={onVoiceStop}
        />
      )}

    </div>
  );
}
