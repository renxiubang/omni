import { useState, useCallback, useRef } from "react";
import * as api from "../api/voicePrintApi";

export interface VoiceProfile {
  id: number;
  user_id: number;
  name: string;
  audio_samples: string[];
  enrollment_text: string;
  created_at: string;
  updated_at: string;
}

export function useVoicePrint(userId: number) {
  // 录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 声纹档案列表
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);

  // 加载和错误状态
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 音量状态 (0-100)
  const [volumeLevel, setVolumeLevel] = useState(0);

  // PCM 采集相关引用（代替 MediaRecorder，确保与通话端 AudioWorklet 一致）
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // 音量分析相关引用
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);

  /**
   * 开始录音
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // 获取麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 重置 PCM 缓冲区
      pcmChunksRef.current = [];

      // 创建 AudioContext（与通话端 AudioWorklet 同样的 PCM 采集路径）
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      // 设置音量分析（AnalyserNode）
      try {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateVolume = () => {
          if (!isRecordingRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const raw = (average / 255) * 100;
          const volume = raw < 5 ? 0 : Math.min(100, Math.round(raw));
          setVolumeLevel(volume);
          animationFrameRef.current = requestAnimationFrame(updateVolume);
        };
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      } catch (analyserErr) {
        console.warn("Failed to setup volume analyser:", analyserErr);
      }

      // 设置 PCM 采集（ScriptProcessorNode，与通话端 AudioWorklet 同一条采集路径）
      const BUFFER_SIZE = 4096;
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!isRecordingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        pcmChunksRef.current.push(int16);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      processorRef.current = processor;
      audioContextRef.current = audioContext;

      isRecordingRef.current = true;
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("无法访问麦克风，请检查权限设置");
    }
  }, []);

  /**
   * 停止录音
   */
  /** 将 PCM Int16 chunks 编码为 WAV Blob */
  function createWavBlob(chunks: Int16Array[], sampleRate: number): Blob {
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const buf = new ArrayBuffer(44 + totalLen * 2);
    const v = new DataView(buf);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + totalLen * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);       // chunk size
    v.setUint16(20, 1, true);         // PCM
    v.setUint16(22, 1, true);         // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true); // byte rate
    v.setUint16(32, 2, true);         // block align
    v.setUint16(34, 16, true);        // bits per sample
    writeStr(36, 'data');
    v.setUint32(40, totalLen * 2, true);
    let offset = 44;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i++) {
        v.setInt16(offset, c[i], true);
        offset += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);

    // 断开 PCM 采集处理器
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // 编码 PCM 数据为 WAV Blob
    const sampleRate = audioContextRef.current?.sampleRate ?? 16000;
    const wavBlob = createWavBlob(pcmChunksRef.current, sampleRate);
    setAudioBlob(wavBlob);
    const url = URL.createObjectURL(wavBlob);
    setAudioUrl(url);

    // 清理音量分析
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    // 停止所有音轨
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setVolumeLevel(0);
  }, []);

  /**
   * 播放录音
   */
  const playAudio = useCallback(() => {
    if (!audioUrl) return;

    // 如果正在播放，停止
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }

    // 播放音频
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onplay = () => setIsPlaying(true);
    audio.onended = () => {
      setIsPlaying(false);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setIsPlaying(false);
      audioRef.current = null;
      setError("播放音频失败");
    };

    audio.play().catch((err) => {
      console.error("Failed to play audio:", err);
      setError("播放音频失败");
      setIsPlaying(false);
    });
  }, [audioUrl]);

  /**
   * 重置录音
   */
  const resetAudio = useCallback(() => {
    // 停止播放
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }

    // 释放 URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    // 重置状态
    setAudioBlob(null);
    setAudioUrl(null);
  }, [audioUrl]);

  /**
   * 录入声纹
   */
  const enrollVoicePrint = useCallback(
    async (name: string, enrollmentText: string, audioSamples: Blob[]) => {
      setIsLoading(true);
      setError(null);

      try {
        // 将 Blob 转换为 File 对象
        const files = audioSamples.map((blob, index) => {
          return new File([blob], `sample_${index}.wav`, {
            type: blob.type,
          });
        });

        // 调用 API
        const profile = await api.enrollVoicePrint(
          userId,
          name,
          enrollmentText,
          files
        );

        // 刷新列表
        await fetchVoiceProfiles();

        return profile;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "声纹录入失败";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  /**
   * 获取声纹档案列表
   */
  const fetchVoiceProfiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const profiles = await api.listVoiceProfiles(userId);
      setVoiceProfiles(profiles);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "获取声纹档案列表失败";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  /**
   * 删除声纹档案
   */
  const deleteVoiceProfile = useCallback(
    async (profileId: number) => {
      setIsLoading(true);
      setError(null);

      try {
        await api.deleteVoiceProfile(profileId, userId);

        // 刷新列表
        await fetchVoiceProfiles();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "删除声纹档案失败";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [userId, fetchVoiceProfiles]
  );

  return {
    // 录音状态
    isRecording,
    audioBlob,
    audioUrl,

    // 音量
    volumeLevel,

    // 播放状态
    isPlaying,

    // 声纹档案列表
    voiceProfiles,

    // 加载和错误状态
    isLoading,
    error,

    // 操作方法
    startRecording,
    stopRecording,
    playAudio,
    resetAudio,
    enrollVoicePrint,
    fetchVoiceProfiles,
    deleteVoiceProfile,
  };
}
