interface Props {
  disabled?: boolean;
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function VoiceHoldButton({ disabled, isRecording, onStart, onStop }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`relative w-10 h-10 rounded-full border flex items-center justify-center text-lg disabled:opacity-40 select-none touch-none transition-all duration-150 ${
        isRecording
          ? "bg-[#ff4444] border-[#ff4444] text-white scale-110 shadow-lg shadow-red-300/50"
          : "bg-[#f5f5f5] border-[#ddd] active:scale-95"
      }`}
      onPointerDown={(e) => {
        e.preventDefault();
        onStart();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onStop();
      }}
      onPointerLeave={(e) => {
        if (e.buttons && !disabled) onStop();
      }}
      onContextMenu={(e) => e.preventDefault()}
      title="按住说话"
    >
      {isRecording ? (
        <span className="relative z-10">
          <span className="inline-block w-2 h-2 bg-white rounded-full animate-ping absolute inset-0 m-auto" />
          🎤
        </span>
      ) : (
        "🎤"
      )}
      {isRecording && (
        <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-40" />
      )}
    </button>
  );
}
