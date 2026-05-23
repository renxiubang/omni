import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { callWsUrl } from "../api/client";
import { PcmPlayer } from "../audio/pcmPlayer";

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
  const [userLine, setUserLine] = useState("");
  const [assistantLine, setAssistantLine] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef(new PcmPlayer());

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
    if (!sessionId) return;
    const ws = new WebSocket(callWsUrl(sessionId));
    wsRef.current = ws;

    ws.onopen = () => setStatus("通话中 — 请说话");
    ws.onclose = () => setStatus("已挂断");
    ws.onerror = () => setStatus("连接错误");

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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      
      ws.send(JSON.stringify({ type: "hangup" }));
      ws.close();
      playerRef.current.stop();
    };
  }, [sessionId, sendUtterance]);

  const hangup = () => {
    wsRef.current?.send(JSON.stringify({ type: "hangup" }));
    wsRef.current?.close();
    navigate(-1);
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] text-white">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-24 h-24 rounded-full bg-[#07c160] flex items-center justify-center text-4xl">
          🤖
        </div>
        <p className="text-lg">{status}</p>
        <div className="w-full max-w-md space-y-3 text-sm text-[#ccc]">
          {userLine && (
            <p>
              <span className="text-[#95ec69]">你：</span>
              {userLine}
            </p>
          )}
          {assistantLine && (
            <p>
              <span className="text-[#7ec8ff]">助手：</span>
              {assistantLine}
            </p>
          )}
        </div>
      </div>
      <div className="p-8 flex justify-center">
        <button
          type="button"
          onClick={hangup}
          className="w-16 h-16 rounded-full bg-red-500 text-white text-xl"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
