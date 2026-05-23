import { useRef, useState, useCallback, useEffect } from "react";
import { VoiceHoldButton } from "./VoiceHoldButton";
import { sttStreamWsUrl } from "../api/client";

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
  /** 流式语音转文字状态：idle | listening | loading */
  const [sttState, setSttState] = useState<"idle" | "listening" | "loading">("idle");
  /** 录音开始前文本框中的文字（松开后不清除） */
  const sttBaseTextRef = useRef("");
  const sttRecorderRef = useRef<MediaRecorder | null>(null);
  const sttWsRef = useRef<WebSocket | null>(null);
  const sttAbortRef = useRef(false);

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

  /* ---- 流式语音转文字（输入框内 🎤 图标，点击切换） ---- */

  /** 开始流式监听 */
  const startListening = useCallback(async () => {
    if (disabled || sttState !== "idle") return;

    sttAbortRef.current = false;
    setSttState("listening");
    sttBaseTextRef.current = text; // 记住已输入的文字

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (sttAbortRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setSttState("idle");
        return;
      }

      // 创建 MediaRecorder
      const rec = new MediaRecorder(stream);
      sttRecorderRef.current = rec;

      // 创建 WebSocket 连接
      const wsUrl = sttStreamWsUrl();
      const ws = new WebSocket(wsUrl);
      sttWsRef.current = ws;

      ws.onopen = () => {
        console.log("[STT-stream] WebSocket connected");
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        rec.start(100); // 每 100ms 发送一次数据
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "partial" && msg.text) {
            const base = sttBaseTextRef.current;
            setText(base ? base + msg.text : msg.text);
          } else if (msg.type === "final" && msg.text) {
            const base = sttBaseTextRef.current;
            setText(base ? base + msg.text : msg.text);
          } else if (msg.type === "error") {
            console.error("[STT-stream] Server error:", msg.message);
            onSttError?.(msg.message || "识别失败");
          }
        } catch {
          // 非 JSON 消息，忽略
        }
      };

      ws.onerror = (e) => {
        console.error("[STT-stream] WebSocket error:", e);
        onSttError?.("连接失败，请重试");
      };

      ws.onclose = () => {
        console.log("[STT-stream] WebSocket closed");
      };

    } catch (err) {
      console.error("[STT-stream] Failed to start:", err);
      setSttState("idle");
      onSttError?.("无法访问麦克风，请检查权限");
    }
  }, [disabled, sttState, text, onSttError]);

  /** 停止流式监听 */
  const stopListening = useCallback(() => {
    sttAbortRef.current = true;

    const rec = sttRecorderRef.current;
    const ws = sttWsRef.current;

    sttRecorderRef.current = null;
    sttWsRef.current = null;

    // 停止 MediaRecorder
    if (rec && rec.state !== "inactive") {
      // 先移除 ondataavailable，避免继续发数据
      rec.ondataavailable = null;
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
      };
      rec.stop();
    }

    // 发送 stop 消息并关闭 WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
      // 给后端一些时间做最终 ASR，然后关闭
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }, 2000);
    }

    setSttState("idle");
  }, []);

  /** 点击切换监听状态 */
  const toggleStt = useCallback(() => {
    if (sttState === "listening" || sttState === "loading") {
      stopListening();
    } else {
      startListening();
    }
  }, [sttState, startListening, stopListening]);

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
                sttState === "listening" ? "正在聆听..." :
                sttState === "loading" ? "识别中..." :
                "输入消息..."
              }
              value={text}
              disabled={disabled || sttState === "listening"}
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
                sttState === "listening"
                  ? "bg-[#07c160]"
                  : "hover:bg-[#f0f0f0]"
              }`}
              onClick={(e) => {
                e.preventDefault();
                toggleStt();
              }}
              onContextMenu={(e) => e.preventDefault()}
              title={sttState === "listening" ? "停止监听" : "语音转文字（点击开始）"}
              disabled={disabled || sttState === "loading"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sttState === "listening" ? "white" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            disabled={disabled || !text.trim() || sttState === "listening"}
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
