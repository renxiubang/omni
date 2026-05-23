import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createSession,
  fetchConfig,
  listPersonas,
  loadMessages,
  streamChat,
  streamVoice,
  streamTts,
  translateToZh,
  sttTranscribe,
  type PersonaInfo,
} from "../api/client";
import { Composer } from "../components/Composer";
import { MessageList } from "../components/MessageList";
import { PcmPlayer } from "../audio/pcmPlayer";
import { pcm16Base64ToWavBlob } from "../audio/pcmToWav";
import { SettingsDrawer } from "./SettingsPage";
import { Toast } from "../components/Toast";
import { CallOptionsPopup } from "../components/CallOptionsPopup";
import type { ChatMessage } from "../types/chat";

export function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  /** 从 localStorage 读取保存的语速，默认 1.0 */
  const getSavedRate = (): number => {
    try {
      const v = localStorage.getItem("omni_speech_rate");
      if (v) {
        const n = parseFloat(v);
        if (n >= 0.5 && n <= 2.0) return n;
      }
    } catch {}
    return 1.0;
  };
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string>("");
  /** 用于强制重渲染：voiceAudioUrls ref 变化时递增 */
  const [voiceUrlVersion, setVoiceUrlVersion] = useState(0);
  /** 正在流式播放音频的 assistant 消息 ID（null 表示未在播放或已中止） */
  const [streamingAudioId, setStreamingAudioId] = useState<string | null>(null);
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
  /** 收集 assistant 的 PCM base64 音频数据，done 时转为 WAV 存入 voiceAudioUrls */
  const assistantAudioChunksRef = useRef<Map<string, string[]>>(new Map());
  const assistantAudioSampleRateRef = useRef<Map<string, number>>(new Map());
  /** 流式期间点击"从头播放"时创建的临时 WAV URL，用于释放 */
  const tempWavUrlRef = useRef<string | null>(null);
  /** 后端配置的输出采样率 */
  const outputSampleRateRef = useRef(16000);
  /** 当前正在显示翻译的消息 ID */
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  /** 正在加载翻译的消息 ID */
  const [translationLoadingId, setTranslationLoadingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showCallOptions, setShowCallOptions] = useState(false);
  /** 正在 TTS 流式播放的消息 ID（文本消息的语音播放） */
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  /** TTS 专用的 PcmPlayer 实例，与通话播放器独立 */
  const ttsPlayerRef = useRef(new PcmPlayer());
  /** 标记 TTS 是否正在运行，用于中止 */
  const ttsAbortRef = useRef(false);

  /** iOS Safari 键盘修复：动态跟踪 visualViewport，保持固定定位元素始终可见 */
  const [vvTop, setVvTop] = useState(0);
  const [vvHeight, setVvHeight] = useState(window.innerHeight);

  useEffect(() => {
    const sync = () => {
      const vv = window.visualViewport;
      if (vv) {
        setVvTop(vv.offsetTop);
        setVvHeight(vv.height);
      }
    };
    sync();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    return () => {
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    };
  }, []);

  // 从路由 state 读取通话时长，挂断后显示通话记录
  useEffect(() => {
    const state = location.state as { callDuration?: number } | null;
    if (state?.callDuration && state.callDuration > 0) {
      const dur = state.callDuration;
      const min = Math.floor(dur / 60);
      const sec = dur % 60;
      const content = `通话时长 ${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      setMessages((prev) => [
        ...prev,
        {
          id: `call-${Date.now()}`,
          role: "system",
          content,
          source: "call",
        },
      ]);
      // 清除 state，防止刷新后重复添加
      navigate("/", { replace: true, state: {} });
    }
  }, [location.state]);

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
              setVoiceUrlVersion((v) => v + 1);
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
          setStreamingAudioId(id); // 立即显示语音条
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
        const sampleRate = Number(data.sample_rate) || outputSampleRateRef.current;
        playerRef.current.enqueuePcm16Base64(String(data.data), sampleRate);
        // 收集音频数据供回放
        const asstId = assistantIdRef.current;
        if (asstId) {
          const arr = assistantAudioChunksRef.current.get(asstId) || [];
          arr.push(String(data.data));
          assistantAudioChunksRef.current.set(asstId, arr);
          assistantAudioSampleRateRef.current.set(asstId, sampleRate);
        }
      }
      if (event === "done") {
        const asstId = assistantIdRef.current;
        assistantIdRef.current = null;
        // 等所有已调度的音频播完再清除流式标记，避免语音条提前消失
        if (asstId && playerRef.current.isPlaying()) {
          playerRef.current.onIdle(() => setStreamingAudioId(null));
        } else {
          setStreamingAudioId(null);
        }
        setMessages((prev) => {
          const target = prev.find((m) => m.role === "assistant" && m.streaming);
          if (!target) return prev;
          return prev.map((m) =>
            m.id === target.id ? { ...m, streaming: false } : m,
          );
        });
        // 将收集的 PCM 音频转为 WAV Blob，供点击回放
        if (asstId) {
          const chunks = assistantAudioChunksRef.current.get(asstId);
          if (chunks && chunks.length > 0) {
            const sr =
              assistantAudioSampleRateRef.current.get(asstId) || outputSampleRateRef.current;
            const wavBlob = pcm16Base64ToWavBlob(chunks, sr);
            voiceAudioUrls.current.set(asstId, URL.createObjectURL(wavBlob));
            setVoiceUrlVersion((v) => v + 1); // 触发重渲染使 hasAudio 生效
          }
          assistantAudioChunksRef.current.delete(asstId);
          assistantAudioSampleRateRef.current.delete(asstId);
        }
      }
      if (event === "error") {
        setStreamingAudioId(null); // 清除流式标记
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
    // 加载后端配置
    fetchConfig()
      .then((c) => {
        outputSampleRateRef.current = c.output_sample_rate;
      })
      .catch(() => {});
    // 加载人格列表
    listPersonas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
    // 创建会话（使用默认人格）
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

  /** 切换人格时重建会话 */
  const handleChangePersona = useCallback(
    async (personaKey: string) => {
      setSelectedPersona(personaKey);
      // 停止当前播放
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      playingVoiceIdRef.current = null;
      setPlayingVoiceId(null);
      setStreamingAudioId(null);
      playerRef.current.stop();
      playerRef.current = new PcmPlayer();
      playerRef.current.prepare();
      // 释放旧 object URL
      voiceAudioUrls.current.forEach((url) => URL.revokeObjectURL(url));
      voiceAudioUrls.current.clear();
      setVoiceUrlVersion(0);
      // 创建新会话
      const id = await createSession(personaKey || undefined);
      setSessionId(id);
      setMessages([]);
      setBusy(false);
    },
    [],
  );

  const runStream = useCallback(
    async (fn: () => Promise<void>) => {
      if (!sessionId || busy) return;
      setBusy(true);
      assistantIdRef.current = null;
      // 停止上一次播放并重置播放器
      playerRef.current.stop();
      playerRef.current = new PcmPlayer();
      // 在用户手势中提前激活 AudioContext，避免 SSE 回调中懒创建被浏览器拦截
      playerRef.current.prepare();
      // 应用保存的语速
      playerRef.current.setPlaybackRate(getSavedRate());
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

  const MIN_VOICE_DURATION_SEC = 1; // 最短录音时长（秒）

  const handleVoiceStop = useCallback((action: "send" | "cancel" | "text") => {
    setIsRecording(false);
    if (action === "cancel") {
      // 取消发送：停止录音并释放资源
      if (mediaRef.current) {
        mediaRef.current.stream.getTracks().forEach((t) => t.stop());
        mediaRef.current = null;
      }
      return;
    }

    const rec = mediaRef.current;
    // 立即置空防止重复调用
    mediaRef.current = null;
    if (!rec || !sessionId) {
      recordingCancelledRef.current = true;
      return;
    }

    const sid = sessionId;
    const duration = Math.round((Date.now() - recordingStartRef.current) / 1000);

    // 录音过短，直接丢弃
    if (duration < MIN_VOICE_DURATION_SEC) {
      rec.stream.getTracks().forEach((t) => t.stop());
      return;
    }

    if (action === "text") {
      // 转文字：录音后识别为文字发送
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const ext = rec.mimeType?.includes("webm") ? "recording.webm" : "recording.wav";
        rec.stream.getTracks().forEach((t) => t.stop());
        try {
          const result = await sttTranscribe(blob, ext);
          if (result && sid) {
            onSendText(result);
          }
        } catch {
          // STT 失败，静默处理
        }
      };
      rec.stop();
      return;
    }

    // action === "send"：发送语音消息
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
      setVoiceUrlVersion((v) => v + 1); // 触发重渲染使 hasAudio 生效
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
  }, [sessionId, busy]);

  /** 点击语音条播放 / 暂停 */
  const handlePlayVoice = useCallback((msgId: string) => {
    // 场景 A：正在流式播放中 → 中止播放（不影响语音合成，继续收集 PCM 数据）
    if (streamingAudioId === msgId) {
      playerRef.current.mute();
      setStreamingAudioId(null);
      return;
    }

    // 场景 B：已静音但仍在流式 → 从头播放已收集的 PCM 数据
    if (assistantAudioChunksRef.current.has(msgId)) {
      const chunks = assistantAudioChunksRef.current.get(msgId)!;
      if (chunks.length > 0) {
        // 释放旧的临时 WAV URL
        if (tempWavUrlRef.current) {
          URL.revokeObjectURL(tempWavUrlRef.current);
          tempWavUrlRef.current = null;
        }

        const sr = assistantAudioSampleRateRef.current.get(msgId) || outputSampleRateRef.current;
        const wavBlob = pcm16Base64ToWavBlob(chunks, sr);
        const url = URL.createObjectURL(wavBlob);
        tempWavUrlRef.current = url;

        if (activeAudioRef.current) {
          activeAudioRef.current.pause();
          activeAudioRef.current = null;
        }

        const audio = new Audio(url);
        audio.playbackRate = getSavedRate();
        audio.onended = () => {
          if (playingVoiceIdRef.current === msgId) {
            playingVoiceIdRef.current = null;
            setPlayingVoiceId(null);
          }
          activeAudioRef.current = null;
          URL.revokeObjectURL(url);
          tempWavUrlRef.current = null;
        };
        audio.onerror = () => {
          if (playingVoiceIdRef.current === msgId) {
            playingVoiceIdRef.current = null;
            setPlayingVoiceId(null);
          }
          activeAudioRef.current = null;
          URL.revokeObjectURL(url);
          tempWavUrlRef.current = null;
        };
        activeAudioRef.current = audio;
        playingVoiceIdRef.current = msgId;
        setPlayingVoiceId(msgId);
        audio.play().catch(() => {
          if (playingVoiceIdRef.current === msgId) {
            playingVoiceIdRef.current = null;
            setPlayingVoiceId(null);
          }
          activeAudioRef.current = null;
          URL.revokeObjectURL(url);
          tempWavUrlRef.current = null;
        });
        return;
      }
    }

    // 场景 C：流式已结束 → 用 WAV URL 回放
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
    audio.playbackRate = getSavedRate();
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
  }, [streamingAudioId]);

  /** 切换翻译显示 */
  const handleToggleTranslation = useCallback(
    async (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;

      // 如果已经显示翻译，则隐藏
      if (translatingId === msgId) {
        setTranslatingId(null);
        return;
      }

      // 如果消息已有翻译内容，直接显示
      if (msg.translation) {
        setTranslatingId(msgId);
        return;
      }

      // 否则调用翻译 API
      setTranslationLoadingId(msgId);
      try {
        const result = await translateToZh(msg.content);
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, translation: result.translation } : m)),
        );
        setTranslatingId(msgId);
      } catch (e) {
        console.error("Translation failed:", e);
      } finally {
        setTranslationLoadingId(null);
      }
    },
    [messages, translatingId],
  );

  /** 对文本消息点击"播放语音"：调用 TTS 接口流式播放 */
  const handlePlayTextVoice = useCallback(
    async (msgId: string, text: string) => {
      // 如果正在播放同一条，则停止
      if (ttsPlayingId === msgId) {
        ttsAbortRef.current = true;
        ttsPlayerRef.current.stop();
        setTtsPlayingId(null);
        return;
      }
      // 停止上一次
      ttsAbortRef.current = true;
      ttsPlayerRef.current.stop();
      ttsPlayerRef.current = new PcmPlayer();
      ttsPlayerRef.current.prepare();
      ttsPlayerRef.current.setPlaybackRate(getSavedRate());
      ttsAbortRef.current = false;
      setTtsPlayingId(msgId);

      try {
        await streamTts({ text }, (event, data) => {
          if (ttsAbortRef.current) return;
          if (event === "assistant_audio") {
            ttsPlayerRef.current.enqueuePcm16Base64(
              String(data.data),
              outputSampleRateRef.current,
            );
          }
          if (event === "done" || event === "error") {
            if (event === "error") console.error("TTS error:", data.message);
            ttsPlayerRef.current.onIdle(() => {
              if (!ttsAbortRef.current) setTtsPlayingId(null);
            });
          }
        });
      } catch (e) {
        console.error("TTS failed:", e);
        setTtsPlayingId(null);
      }
    },
    [ttsPlayingId],
  );

  /* ---- 通话选项弹窗 & Toast ---- */
  const handleCallButton = useCallback(() => {
    setShowCallOptions(true);
  }, []);

  const handleVoiceCall = useCallback(() => {
    if (!sessionId) return;
    setShowCallOptions(false);
    navigate(`/call/${sessionId}`);
  }, [sessionId, navigate]);

  const handleVideoCall = useCallback(() => {
    setShowCallOptions(false);
    setToastMsg("视频通话功能暂未实现");
  }, []);

  /** 当前有音频可播放的消息 ID 集合（user 语音 + assistant TTS） */
  const audioAvailableIds = new Set(voiceAudioUrls.current.keys());
  /** 有未完成的流式音频数据的消息 ID 集合（用于保持语音条可见，即使 streamingAudioId 已清除） */
  const streamingDataIds = new Set(assistantAudioChunksRef.current.keys());

  // 组件卸载时释放所有 object URL
  useEffect(() => {
    const map = voiceAudioUrls.current;
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url));
      map.clear();
      if (tempWavUrlRef.current) {
        URL.revokeObjectURL(tempWavUrlRef.current);
        tempWavUrlRef.current = null;
      }
    };
  }, []);

  // 查找当前 persona 名称
  const currentPersonaName = (() => {
    if (!selectedPersona) return "默认";
    const p = personas.find((x) => x.key === selectedPersona);
    return p ? p.name : "默认";
  })();

  return (
    <div
      className="fixed left-0 right-0 flex flex-col max-w-lg mx-auto bg-[#ededed] shadow-lg overflow-hidden pt-safe pb-safe"
      style={{ top: `${vvTop}px`, height: `${vvHeight}px` }}
    >
      <header className="shrink-0 h-12 flex items-center px-3 bg-[#ededed] border-b border-[#d6d6d6] relative">
        {/* 左侧：设置按钮 */}
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#d6d6d6] transition-colors"
          onClick={() => setShowSettings(true)}
          aria-label="设置"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#333"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* 中间：智能体名称 */}
        <span className="absolute left-1/2 -translate-x-1/2 font-medium text-[17px] text-[#111]">
          {currentPersonaName}
        </span>

        {/* 右侧：persona 下拉框 */}
        {personas.length > 0 && (
          <select
            className="ml-auto text-xs bg-white border border-[#d6d6d6] rounded px-2 py-1 max-w-[130px] truncate"
            value={selectedPersona}
            onChange={(e) => {
              void handleChangePersona(e.target.value);
            }}
            disabled={busy}
          >
            <option value="">默认</option>
            {personas.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </header>
      <MessageList
        messages={messages}
        playingVoiceId={playingVoiceId}
        audioAvailableIds={audioAvailableIds}
        streamingAudioId={streamingAudioId}
        streamingDataIds={streamingDataIds}
        onPlayVoice={handlePlayVoice}
        translatingId={translatingId}
        translationLoadingId={translationLoadingId}
        onToggleTranslation={handleToggleTranslation}
        ttsPlayingId={ttsPlayingId}
        onPlayTextVoice={handlePlayTextVoice}
      />
      <Composer
        disabled={busy || !sessionId}
        isRecording={isRecording}
        onSendText={onSendText}
        onVoiceStart={onVoiceStart}
        onVoiceStop={handleVoiceStop}
        onCall={handleCallButton}
      />
      <SettingsDrawer visible={showSettings} onClose={() => setShowSettings(false)} />
      {toastMsg && (
        <Toast
          message={toastMsg}
          visible={!!toastMsg}
          onClose={() => setToastMsg(null)}
        />
      )}
      <CallOptionsPopup
        visible={showCallOptions}
        onClose={() => setShowCallOptions(false)}
        onVoiceCall={handleVoiceCall}
        onVideoCall={handleVideoCall}
      />
    </div>
  );
}
