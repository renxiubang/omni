import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createSession,
  loadMessages,
  streamChat,
  streamVoice,
} from "../api/client";
import { Composer } from "../components/Composer";
import { MessageList } from "../components/MessageList";
import { PcmPlayer } from "../audio/pcmPlayer";
import type { ChatMessage } from "../types/chat";

export function ChatPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const pendingUserIdRef = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);
  const recordingStartRef = useRef(0);
  const playerRef = useRef(new PcmPlayer());
  /** 存储语音消息的 object URL，用于点击回放 */
  const voiceAudioUrls = useRef<Map<string, string>>(new Map());
  const playingVoiceIdRef = useRef<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleSse = useCallback(
    (event: string, data: Record<string, unknown>) => {
      if (event === "user_message") {
        const id = String(data.id);
        const content = String(data.content ?? "");
        const source = (data.source as ChatMessage["source"]) ?? "text";
        setMessages((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          const pendingIdx = prev.findIndex((m) =>
            m.id.startsWith("user-pending-"),
          );
          if (pendingIdx !== -1) {
            pendingUserIdRef.current = null;
            // 转移语音 blob URL：从 pending ID 映射到服务端 ID
            const pendingId = prev[pendingIdx].id;
            const audioUrl = voiceAudioUrls.current.get(pendingId);
            if (audioUrl) {
              voiceAudioUrls.current.delete(pendingId);
              voiceAudioUrls.current.set(id, audioUrl);
            }
            return prev.map((m, idx) =>
              idx === pendingIdx ? { ...m, id, content, source } : m,
            );
          }
          return [...prev, { id, role: "user", content, source }];
        });
      }
      if (event === "token") {
        const delta = String(data.delta ?? "");
        setMessages((prev) => {
          const existing = prev.find(
            (m) => m.role === "assistant" && m.streaming,
          );
          if (existing) {
            return prev.map((m) =>
              m.id === existing.id
                ? { ...m, content: m.content + delta, streaming: true }
                : m,
            );
          }
          const id = `asst-${Date.now()}`;
          assistantIdRef.current = id;
          return [
            ...prev,
            {
              id,
              role: "assistant",
              content: delta,
              source: "text",
              streaming: true,
            },
          ];
        });
      }
      if (event === "assistant_audio") {
        const sampleRate = Number(data.sample_rate) || 24000;
        playerRef.current.enqueuePcm16Base64(String(data.data), sampleRate);
      }
      if (event === "done") {
        setMessages((prev) => {
          const target = prev.find((m) => m.role === "assistant" && m.streaming);
          if (!target) return prev;
          assistantIdRef.current = null;
          return prev.map((m) =>
            m.id === target.id ? { ...m, streaming: false } : m,
          );
        });
      }
      if (event === "error") {
        setMessages((prev) => {
          const target = prev.find((m) => m.role === "assistant" && m.streaming);
          const next = target
            ? prev.map((m) =>
                m.id === target.id
                  ? {
                      ...m,
                      content: `错误: ${data.message}`,
                      streaming: false,
                    }
                  : m,
              )
            : prev;
          assistantIdRef.current = null;
          return [
            ...next,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: `错误: ${data.message}`,
              source: "text",
            },
          ];
        });
      }
    },
    [],
  );

  useEffect(() => {
    createSession().then(async (id) => {
      setSessionId(id);
      try {
        const hist = await loadMessages(id);
        setMessages(
          hist.map((m: { id: string; role: string; content: string; source: string }) => ({
            id: m.id,
            role: m.role as ChatMessage["role"],
            content: m.content,
            source: (m.source as ChatMessage["source"]) || "text",
          })),
        );
      } catch {
        /* new session */
      }
    });
  }, []);

  const runStream = useCallback(
    async (fn: () => Promise<void>) => {
      if (!sessionId || busy) return;
      setBusy(true);
      assistantIdRef.current = null;
      // 停止上一次播放并重置播放器
      playerRef.current.stop();
      playerRef.current = new PcmPlayer();
      try {
        await fn();
      } catch (e) {
        if (assistantIdRef.current) {
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantIdRef.current),
          );
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `请求失败: ${e instanceof Error ? e.message : String(e)}`,
            source: "text",
          },
        ]);
        assistantIdRef.current = null;
      } finally {
        setBusy(false);
        pendingUserIdRef.current = null;
      }
    },
    [sessionId, busy],
  );

  const onSendText = (text: string) => {
    if (!sessionId) return;
    const pendingId = `user-pending-${Date.now()}`;
    pendingUserIdRef.current = pendingId;
    setMessages((prev) => [
      ...prev,
      { id: pendingId, role: "user", content: text, source: "text" },
    ]);
    void runStream(() =>
      streamChat(
        sessionId,
        text,
        handleSse,
      ),
    );
  };

  const onVoiceStart = async () => {
    setIsRecording(true);
    recordingCancelledRef.current = false;
    recordingStartRef.current = Date.now();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 如果用户在权限弹窗期间松开了按钮，取消录音
      if (recordingCancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        return;
      }
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mediaRef.current = rec;
      rec.start();
    } catch {
      setIsRecording(false);
      alert("无法访问麦克风");
    }
  };

  const onVoiceStop = () => {
    setIsRecording(false);
    const rec = mediaRef.current;
    // 立即置空防止重复调用
    mediaRef.current = null;
    if (!rec || !sessionId) {
      recordingCancelledRef.current = true;
      return;
    }

    const sid = sessionId;
    const duration = Math.round((Date.now() - recordingStartRef.current) / 1000);
    const pendingId = `user-pending-${Date.now()}`;
    pendingUserIdRef.current = pendingId;
    setMessages((prev) => [
      ...prev,
      { id: pendingId, role: "user", content: "[语音]", source: "voice", duration },
    ]);

    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      const ext = rec.mimeType?.includes("webm") ? "recording.webm" : "recording.wav";
      // 存储 object URL 用于点击回放
      voiceAudioUrls.current.set(pendingId, URL.createObjectURL(blob));
      void runStream(() =>
        streamVoice(
          sid,
          blob,
          ext,
          handleSse,
        ),
      );
      rec.stream.getTracks().forEach((t) => t.stop());
    };
    rec.stop();
  };

  /** 点击语音条播放 / 暂停 */
  const handlePlayVoice = useCallback((msgId: string) => {
    const url = voiceAudioUrls.current.get(msgId);
    if (!url) return;

    // 再次点击同一条：暂停
    if (playingVoiceIdRef.current === msgId && activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
      playingVoiceIdRef.current = null;
      setPlayingVoiceId(null);
      return;
    }

    // 停止正在播放的
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    const audio = new Audio(url);
    audio.onended = () => {
      playingVoiceIdRef.current = null;
      setPlayingVoiceId(null);
      activeAudioRef.current = null;
    };
    audio.onerror = () => {
      playingVoiceIdRef.current = null;
      setPlayingVoiceId(null);
      activeAudioRef.current = null;
    };
    activeAudioRef.current = audio;
    playingVoiceIdRef.current = msgId;
    setPlayingVoiceId(msgId);
    audio.play().catch(() => {
      playingVoiceIdRef.current = null;
      setPlayingVoiceId(null);
      activeAudioRef.current = null;
    });
  }, []);

  /** 当前有音频可播放的消息 ID 集合 */
  const audioAvailableIds = new Set(voiceAudioUrls.current.keys());

  return (
    <div className="h-full flex flex-col max-w-lg mx-auto bg-[#ededed] shadow-lg">
      <header className="h-12 flex items-center justify-center bg-[#ededed] border-b border-[#d6d6d6] font-medium text-[17px]">
        智能体对话
      </header>
      <MessageList
        messages={messages}
        playingVoiceId={playingVoiceId}
        audioAvailableIds={audioAvailableIds}
        onPlayVoice={handlePlayVoice}
      />
      <Composer
        disabled={busy || !sessionId}
        isRecording={isRecording}
        onSendText={onSendText}
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
        onCall={() => sessionId && navigate(`/call/${sessionId}`)}
      />
    </div>
  );
}
