import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createSession,
  callWsUrl,
  fetchConfig,
  listPersonas,
  loadMessages,
  streamChat,
  streamVoice,
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
import { WordExplanationPopup } from "../components/WordExplanationPopup";
import { WordbookDrawer } from "../components/WordbookDrawer";
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
  const [, setVoiceUrlVersion] = useState(0);
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
  const [showWordbook, setShowWordbook] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showCallOptions, setShowCallOptions] = useState(false);
  /** 语音转文字结果：非空时将填入输入框 */
  const [voiceTextResult, setVoiceTextResult] = useState<string | null>(null);

  /** ---- 通话内联状态 ---- */
  const [isCalling, setIsCalling] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const callWsRef = useRef<WebSocket | null>(null);
  const callMicStreamRef = useRef<MediaStream | null>(null);
  const callDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 当前通话中 assistant 消息 ID */
  const callAssistantIdRef = useRef<string | null>(null);
  /** 当前通话中用户消息 ID */
  const callUserIdRef = useRef<string | null>(null);

  /** iOS Safari 键盘修复：动态跟踪 visualViewport，保持固定定位元素始终可见 */
  const [vvTop, setVvTop] = useState(0);
  const [vvHeight, setVvHeight] = useState(window.innerHeight);

  /** 单词解释功能：选中的单词和浮框位置 */
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

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

  // 单词选择功能：桌面端 mouseup + 移动端长按选择
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    /** 从选中文本提取单词并显示浮框 */
    const processSelection = () => {
      // 移动端需要延迟一点，等待系统选择完成
      const delay = isMobile ? 100 : 0;
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setSelectedWord(null);
          return;
        }

        const selectedText = selection.toString().trim();
        if (!selectedText) {
          setSelectedWord(null);
          return;
        }

        // 检查是否为英文文本
        if (!/^[a-zA-Z\s\-']+$/.test(selectedText)) {
          setSelectedWord(null);
          return;
        }

        // 获取选中文本的位置
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        setPopupPosition({
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY - 10
        });

        setSelectedWord(selectedText);
      }, delay);
    };

    // ---- 桌面端：使用 mouseup 事件 ----
    if (!isMobile) {
      document.addEventListener('mouseup', processSelection);
      return () => document.removeEventListener('mouseup', processSelection);
    }

    // ============================================================
    // 移动端：禁用默认选择 + 长按触发单词选择
    // ============================================================

    let touchTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    const LONG_PRESS_MS = 500;
    const MOVE_THRESHOLD = 10;

    /** 使用 caretRangeFromPoint 获取触摸点处的单词 */
    const getWordAtPoint = (x: number, y: number): string | null => {
      // 方法1：WebKit caretRangeFromPoint（最精准）
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range && range.startContainer) {
          try {
            (range as any).expand('word');
          } catch {
            // expand('word') 可能不被支持
          }
          const text = range.toString().trim();
          if (/^[a-zA-Z\s\-']+$/.test(text) && /[a-zA-Z]/.test(text)) {
            return text;
          }
        }
      }

      // 方法2：elementFromPoint 回退 — 手动从文本节点提取单词
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      // 获取元素下所有文本
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let allText = '';
      const textNodes: Text[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        textNodes.push(node);
        allText += node.textContent || '';
      }
      if (!allText.trim()) return null;

      // 计算触摸点在整体文本中的字符偏移
      const range = document.createRange();
      let offset = 0;
      for (const tn of textNodes) {
        const len = (tn.textContent || '').length;
        range.setStart(tn, 0);
        range.setEnd(tn, len);
        const rects = range.getClientRects();
        for (let r = 0; r < rects.length; r++) {
          const rect = rects[r];
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            // 在该文本节点中找到大致字符位置
            const charWidth = rect.width / Math.max(len, 1);
            const charIndex = Math.floor((x - rect.left) / charWidth);
            const globalOffset = offset + Math.min(Math.max(charIndex, 0), len);
            // 从该位置向两侧扩展到单词边界
            let start = globalOffset;
            let end = globalOffset;
            while (start > 0 && /[a-zA-Z\-']/.test(allText[start - 1])) start--;
            while (end < allText.length && /[a-zA-Z\-']/.test(allText[end])) end++;
            const word = allText.slice(start, end).trim();
            if (word && /^[a-zA-Z\-']+$/.test(word)) return word;
          }
        }
        offset += len;
      }
      return null;
    };

    /** 检查触摸点是否在消息气泡内 */
    const isInsideMessage = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      let current: HTMLElement | null = el;
      while (current) {
        if (current.hasAttribute('data-message-content')) return true;
        if (
          current.classList.contains('max-w-[75%]') &&
          (current.classList.contains('bg-[#95ec69]') ||
            current.classList.contains('bg-white'))
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      if (!isInsideMessage(e.target)) return;

      touchTimer = setTimeout(() => {
        // 长按触发：查找触摸点处的单词
        const word = getWordAtPoint(touchStartX, touchStartY);
        if (word) {
          setPopupPosition({
            x: touchStartX + window.scrollX,
            y: touchStartY + window.scrollY - 10,
          });
          setSelectedWord(word);
        }
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchTimer) return;
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartX);
      const deltaY = Math.abs(touch.clientY - touchStartY);
      if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    };

    const handleTouchEnd = () => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
    };

    // 辅助：当用户通过系统手势（双击选词等）选中文本时触发弹窗
    let selectionDebounce: ReturnType<typeof setTimeout> | null = null;
    const handleSelectionChange = () => {
      if (selectionDebounce) clearTimeout(selectionDebounce);
      selectionDebounce = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          return;
        }
        const selectedText = selection.toString().trim();
        if (!selectedText || !/^[a-zA-Z\s\-']+$/.test(selectedText)) {
          return;
        }
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopupPosition({
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY - 10,
        });
        setSelectedWord(selectedText);
        // 清除选中状态，避免系统菜单闪现
        selection.removeAllRanges();
      }, 200);
    };

    // 注入样式：仅禁用系统长按菜单，保留文本可选状态（caretRangeFromPoint 需要可选文本）
    const styleEl = document.createElement('style');
    styleEl.id = 'omni-mobile-selection';
    styleEl.textContent = `
      [data-message-content] {
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;
      }
    `;
    document.head.appendChild(styleEl);

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('selectionchange', handleSelectionChange);
      // 清理注入的样式
      if (styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
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
    async (event: string, data: Record<string, unknown>) => {
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
        await playerRef.current.enqueuePcm16Base64(String(data.data), sampleRate);
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
          void playerRef.current.waitForFinish().then(() => setStreamingAudioId(null));
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
      await playerRef.current.prepare(outputSampleRateRef.current);
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
      // 在用户手势中提前激活 AudioContext，await 确保 resume 完成
      await playerRef.current.prepare(outputSampleRateRef.current);
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
      // 转文字：录音后识别为文字，填入输入框
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const ext = rec.mimeType?.includes("webm") ? "recording.webm" : "recording.wav";
        rec.stream.getTracks().forEach((t) => t.stop());
        try {
          const result = await sttTranscribe(blob, ext);
          if (result) {
            setVoiceTextResult(result);
          }
        } catch {
          setToastMsg("语音识别失败，请重试");
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

  /* ---- 内联通话逻辑 ---- */

  const int16ToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const startCall = useCallback(async () => {
    if (!sessionId || isCalling) return;
    setIsCalling(true);
    setCallDuration(0);
    setBusy(true);

    // 停止当前文字/语音消息的播放
    playerRef.current.stop();
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    playingVoiceIdRef.current = null;
    setPlayingVoiceId(null);
    setStreamingAudioId(null);

    const wsUrl = callWsUrl(sessionId);
    const ws = new WebSocket(wsUrl);
    callWsRef.current = ws;

    ws.onopen = () => {
      callDurationTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      switch (msg.type) {
        case "speech_started": {
          // 如果 AI 还在说话，停止播放
          if (callAssistantIdRef.current) {
            playerRef.current.stop();
            setStreamingAudioId(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === callAssistantIdRef.current
                  ? { ...m, streaming: false }
                  : m,
              ),
            );
            callAssistantIdRef.current = null;
          }
          // 新建用户消息气泡
          const uid = `call-user-${Date.now()}`;
          callUserIdRef.current = uid;
          setMessages((prev) => [
            ...prev,
            { id: uid, role: "user", content: "", source: "call", streaming: true },
          ]);
          break;
        }

        case "speech_stopped":
          break;

        case "assistant_transcript":
          // AI 回复的文字转录 → 更新 assistant 气泡
          if (callAssistantIdRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === callAssistantIdRef.current
                  ? { ...m, content: m.content + (msg.delta ?? "") }
                  : m,
              ),
            );
          } else {
            // 还没创建 assistant 气泡（audio delta 还没到），先建一个
            const aid = `call-asst-${Date.now()}`;
            callAssistantIdRef.current = aid;
            setStreamingAudioId(aid);
            setMessages((prev) => [
              ...prev,
              { id: aid, role: "assistant", content: msg.delta ?? "", source: "call", streaming: true },
            ]);
          }
          break;

        case "assistant_transcript_done": {
          // 转录结束，但如果没有 audio delta，这里创建 assistant 消息
          if (!callAssistantIdRef.current) {
            const aid = `call-asst-${Date.now()}`;
            callAssistantIdRef.current = aid;
            setMessages((prev) => [
              ...prev,
              { id: aid, role: "assistant", content: msg.transcript ?? "[空]", source: "call", streaming: false },
            ]);
          }
          break;
        }

        // 用户语音 ASR 转写 → 更新用户气泡
        case "user_transcript":
          if (callUserIdRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === callUserIdRef.current
                  ? { ...m, content: m.content + (msg.delta ?? "") }
                  : m,
              ),
            );
          }
          break;

        case "user_transcript_done":
          if (callUserIdRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === callUserIdRef.current
                  ? { ...m, content: msg.transcript ?? m.content, streaming: false }
                  : m,
              ),
            );
            callUserIdRef.current = null;
          }
          break;

        case "assistant_audio": {
          const b64 = msg.data as string;
          const sr = (msg.sample_rate as number) ?? 24000;
          playerRef.current.enqueuePcm16Base64(b64, sr);

          // 创建或更新 assistant 消息
          if (!callAssistantIdRef.current) {
            const aid = `call-asst-${Date.now()}`;
            callAssistantIdRef.current = aid;
            setStreamingAudioId(aid);
            // 收集 PCM 数据供回放
            assistantAudioChunksRef.current.set(aid, [b64]);
            assistantAudioSampleRateRef.current.set(aid, sr);
            setMessages((prev) => [
              ...prev,
              { id: aid, role: "assistant", content: "", source: "call", streaming: true },
            ]);
          } else {
            // 追加 PCM 数据
            const arr = assistantAudioChunksRef.current.get(callAssistantIdRef.current) || [];
            arr.push(b64);
            assistantAudioChunksRef.current.set(callAssistantIdRef.current, arr);
          }
          break;
        }

        case "turn_end": {
          const aid = callAssistantIdRef.current;
          callAssistantIdRef.current = null;
          setStreamingAudioId(null);
          if (aid) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aid ? { ...m, streaming: false } : m,
              ),
            );
            // 将 PCM 转为 WAV 供回放
            const chunks = assistantAudioChunksRef.current.get(aid);
            if (chunks && chunks.length > 0) {
              const sr =
                assistantAudioSampleRateRef.current.get(aid) || 24000;
              const wavBlob = pcm16Base64ToWavBlob(chunks, sr);
              voiceAudioUrls.current.set(aid, URL.createObjectURL(wavBlob));
              setVoiceUrlVersion((v) => v + 1);
            }
            assistantAudioChunksRef.current.delete(aid);
            assistantAudioSampleRateRef.current.delete(aid);
          }
          break;
        }

        case "error":
          console.error("Call error:", msg.message);
          break;
      }
    };

    ws.onclose = () => {
      if (isCalling) stopCall();
    };

    ws.onerror = () => {
      setToastMsg("通话连接失败");
      stopCall();
    };

    // 获取麦克风
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      callMicStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule("/audio-worklet-processor.js");
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "audio-stream");

      node.port.onmessage = (e) => {
        if (e.data.type === "audio_chunk" && e.data.buffer) {
          const b64 = int16ToBase64(e.data.buffer as ArrayBuffer);
          try {
            ws.send(JSON.stringify({ type: "audio_chunk", data: b64 }));
          } catch { /* ws closed */ }
        }
      };
      source.connect(node);
    } catch {
      setToastMsg("无法访问麦克风");
      stopCall();
    }
  }, [sessionId, isCalling]);

  const stopCall = useCallback(() => {
    setIsCalling(false);
    setBusy(false);
    setStreamingAudioId(null);

    if (callDurationTimerRef.current) {
      clearInterval(callDurationTimerRef.current);
      callDurationTimerRef.current = null;
    }

    // 清理通话 WS
    if (callWsRef.current) {
      try { callWsRef.current.send(JSON.stringify({ type: "hangup" })); } catch {}
      callWsRef.current.close();
      callWsRef.current = null;
    }

    // 清理麦克风
    if (callMicStreamRef.current) {
      callMicStreamRef.current.getTracks().forEach((t) => t.stop());
      callMicStreamRef.current = null;
    }

    // 定型未完成的用户消息
    if (callUserIdRef.current) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === callUserIdRef.current
            ? { ...m, streaming: false, content: m.content || "[语音]" }
            : m,
        ),
      );
      callUserIdRef.current = null;
    }

    // 定型未完成的 assistant 消息
    if (callAssistantIdRef.current) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === callAssistantIdRef.current
            ? { ...m, streaming: false }
            : m,
        ),
      );
      callAssistantIdRef.current = null;
    }

    // 插入通话记录
    if (callDuration > 0) {
      const min = Math.floor(callDuration / 60);
      const sec = callDuration % 60;
      const content = `通话时长 ${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      setMessages((prev) => [
        ...prev,
        { id: `call-summary-${Date.now()}`, role: "system", content, source: "call" },
      ]);
    }
  }, [callDuration]);

  /* ---- 通话选项弹窗 & Toast ---- */
  const handleCallButton = useCallback(() => {
    setShowCallOptions(true);
  }, []);

  const handleVoiceCall = useCallback(() => {
    setShowCallOptions(false);
    startCall();
  }, [startCall]);

  const handleVideoCall = useCallback(() => {
    setShowCallOptions(false);
    setToastMsg("视频通话功能暂未实现");
  }, []);

  /** TTS 相关状态已移除，统一使用模型音频输出 */
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

        {/* 右侧：persona 下拉框 + 单词本按钮 */}
        <div className="ml-auto flex items-center gap-1">
          {personas.length > 0 && (
            <select
              className="text-xs bg-white border border-[#d6d6d6] rounded px-2 py-1 max-w-[130px] truncate"
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
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#d6d6d6] transition-colors"
            onClick={() => setShowWordbook(true)}
            aria-label="单词本"
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
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </button>
        </div>
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
      />
      <Composer
        disabled={busy || !sessionId}
        isRecording={isRecording}
        isCalling={isCalling}
        callDuration={callDuration}
        onSendText={onSendText}
        onVoiceStart={onVoiceStart}
        onVoiceStop={handleVoiceStop}
        onCall={handleCallButton}
        onHangup={stopCall}
        onSttError={(msg) => setToastMsg(msg)}
        voiceTextResult={voiceTextResult}
        onVoiceTextConsumed={() => setVoiceTextResult(null)}
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

      {/* 单词解释浮框 */}
      {selectedWord && (
        <WordExplanationPopup
          selectedText={selectedWord}
          position={popupPosition}
          onClose={() => setSelectedWord(null)}
        />
      )}

      {/* 单词本侧滑抽屉 */}
      <WordbookDrawer
        visible={showWordbook}
        onClose={() => setShowWordbook(false)}
      />
    </div>
  );
}
