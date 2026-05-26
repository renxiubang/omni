import { useRef, useEffect } from "react";

interface VideoCallViewProps {
  /** 当前通话的 WebSocket 引用，用于发送 image_chunk */
  wsRef: React.MutableRefObject<WebSocket | null>;
  /** 关闭视频（停止摄像头） */
  onClose: () => void;
}

/**
 * 视频通话摄像头小窗组件。
 *
 * - 打开摄像头本地预览（右上角悬浮）
 * - 1fps 截帧编码为 JPEG base64 通过 WebSocket 发送
 * - 复用现有语音通话的 WebSocket 连接，仅增加图像帧数据
 *
 * DashScope 要求：
 * - 图像格式 JPEG，推荐 480P/720P
 * - 约 1 帧/秒
 * - 需在发送音频后开始发送图像（语音通话已满足）
 */
export function VideoCallView({ wsRef, onClose }: VideoCallViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // 1. 打开摄像头
    navigator.mediaDevices
      .getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // 2. 启动 1fps 截帧循环
        const captureFrame = () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ws = wsRef.current;

          // 摄像头未就绪或 WebSocket 未打开，延迟重试
          if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !ws || ws.readyState !== WebSocket.OPEN) {
            frameTimerRef.current = window.setTimeout(captureFrame, 1000);
            return;
          }

          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            frameTimerRef.current = window.setTimeout(captureFrame, 1000);
            return;
          }

          ctx.drawImage(video, 0, 0, 640, 480);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const b64 = (reader.result as string).split(",")[1];
                  try {
                    wsRef.current?.send(
                      JSON.stringify({ type: "image_chunk", data: b64 })
                    );
                  } catch {
                    // ws closed
                  }
                };
                reader.readAsDataURL(blob);
              }
              // 调度下一帧（用 setTimeout 而非 setInterval，确保上一帧处理完成）
              frameTimerRef.current = window.setTimeout(captureFrame, 1000);
            },
            "image/jpeg",
            0.7
          );
        };

        frameTimerRef.current = window.setTimeout(captureFrame, 1000);
      })
      .catch((err) => {
        console.error("VideoCallView: camera access failed", err);
      });

    // 3. 清理：停止摄像头、取消定时器
    return () => {
      if (frameTimerRef.current) {
        clearTimeout(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fixed top-20 right-4 w-60 rounded-xl overflow-hidden shadow-lg bg-black z-50">
      {/* 摄像头本地预览（镜面翻转） */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* 隐藏 canvas，用于截帧 */}
      <canvas ref={canvasRef} className="hidden" />

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center text-sm hover:bg-black/70 transition-colors"
        title="关闭摄像头"
      >
        ✕
      </button>
    </div>
  );
}
