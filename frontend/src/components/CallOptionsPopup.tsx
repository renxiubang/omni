interface CallOptionsPopupProps {
  visible: boolean;
  onClose: () => void;
  onVoiceCall: () => void;
  onVideoCall: () => void;
}

export function CallOptionsPopup({
  visible,
  onClose,
  onVoiceCall,
  onVideoCall,
}: CallOptionsPopupProps) {
  if (!visible) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/30 z-50"
        onClick={onClose}
      />

      {/* 弹出层 */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-51 w-64 bg-white rounded-lg shadow-xl overflow-hidden">
        {/* 语音通话 */}
        <button
          type="button"
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f5f5f5] transition-colors text-[17px]"
          onClick={() => { onClose(); onVoiceCall(); }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span>语音通话</span>
        </button>

        <div className="h-[1px] bg-[#eee]" />

        {/* 视频通话（占位） */}
        <button
          type="button"
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f5f5f5] transition-colors text-[17px] opacity-50 cursor-not-allowed"
          onClick={() => { onClose(); onVideoCall(); }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          <span>视频通话</span>
        </button>

        <div className="h-[1px] bg-[#eee]" />

        {/* 取消 */}
        <button
          type="button"
          className="w-full flex items-center justify-center px-4 py-3 hover:bg-[#f5f5f5] transition-colors text-[17px] text-[#ff4444]"
          onClick={onClose}
        >
          取消
        </button>
      </div>
    </>
  );
}
