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

  // MediaRecorder 引用
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string>("audio/webm");

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

      // 创建 MediaRecorder，使用浏览器支持的格式
      let mimeType = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      recordedMimeTypeRef.current = mediaRecorder.mimeType;

      // 处理数据可用事件
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      // 处理录音停止事件
      mediaRecorder.onstop = () => {
        // 使用实际的 mimeType 创建 Blob
        const actualMimeType = recordedMimeTypeRef.current;
        const audioBlob = new Blob(recordedChunksRef.current, {
          type: actualMimeType,
        });
        setAudioBlob(audioBlob);

        // 创建 URL
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // 停止所有音轨
        stream.getTracks().forEach((track) => track.stop());
      };

      // 设置音量分析
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
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
          // 将音量映射到 0-100 范围（加入阈值避免噪声抖动）
          const raw = (average / 255) * 100;
          const volume = raw < 5 ? 0 : Math.min(100, Math.round(raw));
          setVolumeLevel(volume);
          animationFrameRef.current = requestAnimationFrame(updateVolume);
        };
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      } catch (analyserErr) {
        console.warn("Failed to setup volume analyser:", analyserErr);
      }

      // 开始录音
      mediaRecorder.start();
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
  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      isRecordingRef.current = false;
    }

    // 清理音量分析
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
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
          return new File([blob], `sample_${index}.webm`, {
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
