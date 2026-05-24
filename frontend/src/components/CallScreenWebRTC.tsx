import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallScreenWebRTC() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState("连接中...");
  const [callDuration, setCallDuration] = useState(0);
  const [subtitleList, _setSubtitleList] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const trackReceivedRef = useRef(false); // 防止 ontrack 被多次调用

  // 字幕区域自动滚动到底部
  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.scrollTop = subtitleRef.current.scrollHeight;
    }
  }, [subtitleList]);

  useEffect(() => {
    if (!sessionId) {
      setStatus("错误：会话ID为空");
      return;
    }

    const startCall = async () => {
      try {
        console.log("[CallScreenWebRTC] Starting WebRTC call...");
        
        // 1. 获取麦克风，强制开启回声消除和降噪
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 48000 }
          },
          video: false
        });

        // 2. 创建 RTCPeerConnection
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        // 3. 将麦克风音频流发送给后端
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        // 4. 接收后端返回的 AI 音频流并播放
        pc.ontrack = (event) => {
          if (trackReceivedRef.current) {
            console.log("[CallScreenWebRTC] Track already received, skipping");
            return;
          }
          trackReceivedRef.current = true;
          
          const newStream = event.streams[0];
          const track = event.track;
          console.log("[CallScreenWebRTC] Received remote audio track", {
            streamId: newStream?.id,
            trackId: track?.id,
            trackReadyState: track.readyState,
            trackMuted: track.muted,
            trackEnabled: track.enabled
          });

          // 🔊 使用 Web Audio API 分析音频轨道是否真的有数据
          try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(newStream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // 每秒检查一次音频数据
            const audioCheckInterval = setInterval(() => {
              analyser.getByteTimeDomainData(dataArray);
              
              // 计算音量
              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                const val = (dataArray[i] - 128) / 128;
                sum += val * val;
              }
              const rms = Math.sqrt(sum / bufferLength);
              const volumeDb = 20 * Math.log10(rms + 1e-6);
              
              console.log("[CallScreenWebRTC] 🔊 Audio analysis:", {
                volume: rms.toFixed(4),
                volumeDb: volumeDb.toFixed(2) + " dB",
                hasSignal: rms > 0.01,
                buffer: Array.from(dataArray.slice(0, 20))
              });
              
              if (rms < 0.001) {
                console.warn("[CallScreenWebRTC] ⚠️ No audio signal detected! Check if track has data.");
              }
            }, 1000);
            
            // 清理
            event.track.addEventListener('ended', () => {
              clearInterval(audioCheckInterval);
              audioContext.close();
            });
            
            console.log("[CallScreenWebRTC] ✅ Audio analysis started");
          } catch (e) {
            console.error("[CallScreenWebRTC] ❌ Failed to create audio analyzer:", e);
          }
          
          // 监听轨道状态变化
          track.addEventListener('ended', () => {
            console.warn("[CallScreenWebRTC] Remote audio track ended");
          });
          track.addEventListener('mute', () => {
            console.warn("[CallScreenWebRTC] Remote audio track muted");
          });
          track.addEventListener('unmute', () => {
            console.log("[CallScreenWebRTC] Remote audio track unmuted");
          });
          
          if (!remoteAudioRef.current) {
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.playsInline = true;
            audio.volume = 0.8; // 设置音量为 80%
            document.body.appendChild(audio);
            remoteAudioRef.current = audio;
            console.log("[CallScreenWebRTC] Audio element created");
          }
          
          remoteAudioRef.current.srcObject = newStream;
          console.log("[CallScreenWebRTC] srcObject set, attempting to play...");
          
          // 尝试播放
          const playPromise = remoteAudioRef.current.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log("[CallScreenWebRTC] ✅ Audio playing successfully");
            }).catch(e => {
              if (e.name !== 'AbortError') {
                console.error("[CallScreenWebRTC] ❌ Audio play error:", e);
                console.error("[CallScreenWebRTC] Error name:", e.name);
                console.error("[CallScreenWebRTC] Error message:", e.message);
              } else {
                console.log("[CallScreenWebRTC] AbortError (normal, play() was interrupted)");
              }
            });
          }
          
          // 监听音频播放事件
          remoteAudioRef.current.addEventListener('playing', () => {
            console.log("[CallScreenWebRTC] ✅ Audio element 'playing' event");
            // 打印音频元素的详细状态
            const audio = remoteAudioRef.current!;
            console.log("[CallScreenWebRTC] Audio state:", {
              paused: audio.paused,
              currentTime: audio.currentTime,
              duration: audio.duration,
              volume: audio.volume,
              muted: audio.muted,
              readyState: audio.readyState,
              networkState: audio.networkState,
            });
          });
          remoteAudioRef.current.addEventListener('waiting', () => {
            console.warn("[CallScreenWebRTC] ⚠️ Audio element 'waiting' event (buffering)");
          });
          remoteAudioRef.current.addEventListener('error', (e) => {
            console.error("[CallScreenWebRTC] ❌ Audio element error:", e);
          });
          remoteAudioRef.current.addEventListener('stalled', () => {
            console.warn("[CallScreenWebRTC] ⚠️ Audio element 'stalled' event");
          });
          
          // 每秒打印一次音频播放状态
          const statusInterval = setInterval(() => {
            if (remoteAudioRef.current) {
              const audio = remoteAudioRef.current;
              console.log("[CallScreenWebRTC] Audio status:", {
                paused: audio.paused,
                currentTime: audio.currentTime,
                volume: audio.volume,
              });
            } else {
              clearInterval(statusInterval);
            }
          }, 3000);
        };

        // 5. 生成 Offer 并发送给 Python 后端
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch('/api/webrtc/offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sdp: pc.localDescription!.sdp,
            type: pc.localDescription!.type
          })
        });

        if (!response.ok) {
          throw new Error(`SDP exchange failed: ${response.statusText}`);
        }

        const answer = await response.json();
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        setStatus("通话中 — 请说话");
        console.log("[CallScreenWebRTC] WebRTC connection established");

        // 开始计时
        timerRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      } catch (err) {
        console.error("[CallScreenWebRTC] Failed to start call:", err);
        setStatus("连接失败");
      }
    };

    startCall();

    return () => {
      console.log("[CallScreenWebRTC] Cleanup");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
      trackReceivedRef.current = false;
    };
  }, [sessionId]);

  const hangup = () => {
    const duration = callDuration;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }
    navigate("/", { state: { callDuration: duration } });
  };

  const isConnected = status.includes("通话中");

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] text-white select-none">
      {/* 顶部状态 */}
      <div className="pt-12 pb-4 flex flex-col items-center">
        <p className="text-sm text-[#999]">{status}</p>
      </div>

      {/* AI 头像区 */}
      <div className="flex justify-center mt-4 mb-6 relative">
        <div className="w-32 h-32 rounded-full bg-[#07c160] flex items-center justify-center text-6xl relative">
          🤖
          {isConnected && (
            <>
              <span className="absolute inset-0 rounded-full bg-[#07c160] opacity-30 animate-ping" />
              <span className="absolute inset-0 rounded-full bg-[#07c160] opacity-20 animate-pulse" />
            </>
          )}
        </div>
      </div>

      {/* 通话时长 */}
      <div className="text-center mb-8">
        <span className="text-5xl font-light tabular-nums tracking-wider">
          {formatDuration(callDuration)}
        </span>
      </div>

      {/* 实时字幕区 */}
      <div
        ref={subtitleRef}
        className="flex-1 overflow-y-auto px-6 space-y-3 max-h-48 mb-4"
      >
        {subtitleList.map((item, idx) => (
          <div
            key={idx}
            className={`text-sm ${item.role === "user" ? "text-right" : "text-left"}`}
          >
            <span
              className={`inline-block max-w-[80%] rounded-lg px-3 py-2 ${
                item.role === "user"
                  ? "bg-[#07c160] text-white"
                  : "bg-[#2a2a2a] text-[#ccc]"
              }`}
            >
              {item.role === "user" ? "你" : "助手"}：{item.text}
            </span>
          </div>
        ))}
      </div>

      {/* 底部挂断按钮 */}
      <div className="p-8 flex justify-center">
        <button
          type="button"
          onClick={hangup}
          className="w-20 h-20 rounded-full bg-red-500 text-white text-3xl shadow-lg active:scale-95 transition-transform cursor-pointer"
          title="挂断"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
