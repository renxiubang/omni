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
import type { ChatMessage } from "../types/chat";

function handleSseEvents(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  assistantIdRef: React.MutableRefObject<string | null>,
  pendingUserIdRef: React.MutableRefObject<string | null>,
) {
  return (event: string, data: Record<string, unknown>) => {
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
  };
}

export function ChatPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const assistantIdRef = useRef<string | null>(null);
  const pendingUserIdRef = useRef<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
        handleSseEvents(setMessages, assistantIdRef, pendingUserIdRef),
      ),
    );
  };

  const onVoiceStart = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mediaRef.current = rec;
      rec.start();
    } catch {
      alert("无法访问麦克风");
    }
  };

  const onVoiceStop = () => {
    const rec = mediaRef.current;
    if (!rec || !sessionId) return;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      const ext = rec.mimeType?.includes("webm") ? "recording.webm" : "recording.wav";
      void runStream(() =>
        streamVoice(
          sessionId,
          blob,
          ext,
          handleSseEvents(setMessages, assistantIdRef, pendingUserIdRef),
        ),
      );
      rec.stream.getTracks().forEach((t) => t.stop());
    };
    rec.stop();
    mediaRef.current = null;
  };

  return (
    <div className="h-full flex flex-col max-w-lg mx-auto bg-[#ededed] shadow-lg">
      <header className="h-12 flex items-center justify-center bg-[#ededed] border-b border-[#d6d6d6] font-medium text-[17px]">
        智能体对话
      </header>
      <MessageList messages={messages} />
      <Composer
        disabled={busy || !sessionId}
        onSendText={onSendText}
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
        onCall={() => sessionId && navigate(`/call/${sessionId}`)}
      />
    </div>
  );
}
