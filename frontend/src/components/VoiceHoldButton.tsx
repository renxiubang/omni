interface Props {
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function VoiceHoldButton({ disabled, onStart, onStop }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="w-10 h-10 rounded-full bg-[#f5f5f5] border border-[#ddd] flex items-center justify-center text-lg disabled:opacity-40 select-none touch-none"
      onPointerDown={(e) => {
        e.preventDefault();
        onStart();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onStop();
      }}
      onPointerLeave={(e) => {
        if (e.buttons) onStop();
      }}
      title="按住说话"
    >
      🎤
    </button>
  );
}
