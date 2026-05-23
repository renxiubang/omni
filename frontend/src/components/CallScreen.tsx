import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { callWsUrl } from "../api/client";
import { PcmPlayer } from "../audio/pcmPlayer";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function floatToWavBlob(int16Buffer: ArrayBuffer, sampleRate = 16000): Blob {
  const samples = new Int16Array(int16Buffer);
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    view.setInt16(o, samples[i], true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function CallScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState("连接中...");
  const [callDuration, setCallDuration] = useState(0);
  const [userLine, setUserLine] = useState("");
  const [assistantLine, setAssistantLine] = useState("");
  const [subtitleList, setSubtitleList] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef(new PcmPlayer());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);

  // 同步字幕列表：userLine / assistantLine 变化时追加
  useEffect(() => {
    if (userLine) {
      setSubtitleList((prev) => {
        // 避免重复追加同一句
        if (prev.length && prev[prev.length - 1].role === "user" && prev[prev.length - 1].text === userLine) return prev;
        return [...prev, { role: "user", text: userLine }];
      });
    }
  }, [userLine]);

  useEffect(() => {
    if (assistantLine) {
      setSubtitleList((prev) => {
        const last = prev.length ? prev[prev.length - 1] : null;
        if (last && last.role === "assistant") {
          // 更新最后一条 assistant 字幕
          return [...prev.slice(0, -1), { role: "assistant", text: assistantLine }];
        }
        return [...prev, { role: "assistant", text: assistantLine }];
      });
    }
  }, [assistantLine]);

  // 字幕区域自动滚动到底部
  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.scrollTop = subtitleRef.current.scrollHeight;
    }
  }, [subtitleList]);

  const sendUtterance = useCallback((int16Buffer: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const wav = floatToWavBlob(int16Buffer, 16000);
    wav.arrayBuffer().then((ab) => {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
      ws.send(JSON.stringify({ type: "utterance_end", data: b64 }));
    });
  }, []);

  useEffect(() => {
    if (!sessionId) {
      console.error("CallScreen: sessionId is empty, cannot connect");
      setStatus("错误：会话ID为空");
      return;
    }

    const wsUrl = callWsUrl(sessionId);
    console.log(`CallScreen: Connecting to WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // 跟踪是否已经发生错误，防止 onclose 覆盖错误状态
    const hasErrorRef = { current: false };

    ws.onopen = () => {
      console.log("CallScreen: WebSocket connected successfully");
      setStatus("通话中 — 请说话");
      // 连接成功后开始计时
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    };
    ws.onclose = (event) => {
      console.log(`CallScreen: WebSocket closed: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
      // 如果已经设置过错误状态，不要再覆盖为"已挂断"
      if (!hasErrorRef.current) {
        setStatus("已挂断");
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    ws.onerror = (error) => {
      console.error("CallScreen: WebSocket error:", error);
      hasErrorRef.current = true;
      setStatus("连接错误 - 请检查后端服务是否启动");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      switch (msg.type) {
        case "user_final":
          setUserLine(msg.text ?? "");
          setAssistantLine("");
          break;
        case "assistant_token":
          setAssistantLine((t) => t + (msg.delta ?? ""));
          break;
        case "assistant_audio":
          playerRef.current.enqueuePcm16Base64(msg.data, msg.sample_rate ?? 24000);
          break;
        case "turn_cancelled":
          playerRef.current.stop();
          playerRef.current = new PcmPlayer();
          setAssistantLine("");
          break;
        case "turn_end":
          break;
        case "error":
          setStatus(msg.message ?? "错误");
          break;
      }
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule("/audio-worklet-processor.js");
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "utterance-processor");
        node.port.onmessage = (e) => {
          if (e.data.type === "speechStart") {
            playerRef.current.stop();
            playerRef.current = new PcmPlayer();
            setAssistantLine("");
          }
          if (e.data.type === "utterance_end" && e.data.buffer) {
            sendUtterance(e.data.buffer);
          }
        };
        source.connect(node);
      } catch (err) {
        setStatus("无法访问麦克风");
        console.error(err);
      }
    })();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        ws.send(JSON.stringify({ type: "hangup" }));
      } catch { /* ignore */ }
      ws.close();
      playerRef.current.stop();
    };
  }, [sessionId, sendUtterance]);

  const hangup = () => {
    const duration = callDuration;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      wsRef.current?.send(JSON.stringify({ type: "hangup" }));
    } catch { /* ignore */ }
    wsRef.current?.close();
    // 通过 navigate state 将通话时长传回 ChatPage
    navigate("/", { state: { callDuration: duration } });
  };

  const isConnected = status.includes("通话中") || status === "已挂断";

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
          {/* 脉冲动画：通话中时显示 */}
          {isConnected && !status.includes("挂断") && (
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
