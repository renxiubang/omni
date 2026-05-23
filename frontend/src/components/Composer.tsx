import { useState } from "react";
import { VoiceHoldButton } from "./VoiceHoldButton";

interface Props {
  disabled?: boolean;
  isRecording: boolean;
  onSendText: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onCall: () => void;
}

export function Composer({
  disabled,
  isRecording,
  onSendText,
  onVoiceStart,
  onVoiceStop,
  onCall,
}: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSendText(t);
    setText("");
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[#f7f7f7] border-t border-[#ddd]">
      <VoiceHoldButton
        disabled={disabled}
        isRecording={isRecording}
        onStart={onVoiceStart}
        onStop={onVoiceStop}
      />
      <button
        type="button"
        className="w-10 h-10 rounded-full bg-[#07c160] text-white text-sm font-medium disabled:opacity-40"
        onClick={onCall}
        disabled={disabled}
        title="语音通话"
      >
        📞
      </button>
      <input
        className="flex-1 h-9 rounded-md border border-[#ddd] px-3 text-[15px] bg-white outline-none focus:border-[#07c160]"
        placeholder="输入消息..."
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="px-4 h-9 rounded-md bg-[#07c160] text-white text-[15px] disabled:opacity-40"
        disabled={disabled || !text.trim()}
        onClick={submit}
      >
        发送
      </button>
    </div>
  );
}
