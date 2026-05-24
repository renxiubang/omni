import { useState, useEffect, useCallback } from "react";
import { useVoicePrint } from "../hooks/useVoicePrint";

interface VoicePrintEnrollProps {
  userId: number;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = "guide" | "recording" | "playback" | "success";

export function VoicePrintEnroll({
  userId,
  onClose,
  onSuccess,
}: VoicePrintEnrollProps) {
  // 当前步骤
  const [step, setStep] = useState<Step>("guide");

  // 声纹档案名称
  const [profileName, setProfileName] = useState("");

  // 录入文本
  const [enrollmentText, setEnrollmentText] = useState(
    "我是用户，这是我的声纹信息"
  );

  // 已录制的样本
  const [recordedSamples, setRecordedSamples] = useState<Blob[]>([]);

  // 当前需要录制的样本数量
  const totalSamples = 3;

  // 使用 useVoicePrint Hook
  const {
    isRecording,
    audioBlob,
    audioUrl: _audioUrl,
    isPlaying,
    isLoading,
    error,
    startRecording,
    stopRecording,
    playAudio,
    resetAudio,
    enrollVoicePrint,
  } = useVoicePrint(userId);

  // 错误提示
  const [localError, setLocalError] = useState<string | null>(null);

  // 清除错误
  useEffect(() => {
    if (error) {
      setLocalError(error);
    }
  }, [error]);

  // 开始录制
  const handleStartRecording = useCallback(() => {
    setLocalError(null);
    startRecording();
  }, [startRecording]);

  // 停止录制
  const handleStopRecording = useCallback(() => {
    stopRecording();
    // 切换到回放确认步骤
    setStep("playback");
  }, [stopRecording]);

  // 确认使用当前录制
  const handleConfirmSample = useCallback(() => {
    if (!audioBlob) return;

    // 添加到已录制样本列表
    setRecordedSamples((prev) => [...prev, audioBlob]);

    // 重置音频
    resetAudio();

    // 如果已录制足够样本，进入完成步骤
    if (recordedSamples.length + 1 >= totalSamples) {
      setStep("success");
    } else {
      // 否则继续录制
      setStep("recording");
    }
  }, [audioBlob, recordedSamples.length, resetAudio]);

  // 重录当前样本
  const handleRerecord = useCallback(() => {
    resetAudio();
    setStep("recording");
  }, [resetAudio]);

  // 提交声纹档案
  const handleSubmit = useCallback(async () => {
    if (!profileName.trim()) {
      setLocalError("请输入声纹档案名称");
      return;
    }

    if (recordedSamples.length < totalSamples) {
      setLocalError(`请至少录制 ${totalSamples} 个样本`);
      return;
    }

    try {
      setLocalError(null);
      await enrollVoicePrint(profileName, enrollmentText, recordedSamples);

      if (onSuccess) {
        onSuccess();
      }

      // 关闭抽屉
      onClose();
    } catch (err) {
      // 错误已经在 Hook 中处理
      console.error("Failed to enroll voice print:", err);
    }
  }, [
    profileName,
    enrollmentText,
    recordedSamples,
    totalSamples,
    enrollVoicePrint,
    onSuccess,
    onClose,
  ]);

  // 渲染引导页面
  const renderGuide = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-col items-center justify-center h-full">
        {/* 图标 */}
        <div className="w-20 h-20 rounded-full bg-[#07c160] flex items-center justify-center mb-6">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>

        {/* 标题 */}
        <h2 className="text-[20px] font-semibold text-[#111] mb-3">
          声纹录入引导
        </h2>

        {/* 说明文本 */}
        <p className="text-[15px] text-[#666] text-center mb-8 max-w-[280px]">
          请按照以下文本朗读 {totalSamples} 次，以提高声纹识别准确度
        </p>

        {/* 录入文本 */}
        <div className="w-full max-w-[320px] bg-white rounded-lg p-4 mb-8">
          <div className="text-[15px] text-[#111] text-center">
            {enrollmentText}
          </div>
        </div>

        {/* 可编辑录入文本 */}
        <div className="w-full max-w-[320px] mb-6">
          <label className="block text-[13px] text-[#999] mb-2">
            自定义录入文本（可选）
          </label>
          <input
            type="text"
            value={enrollmentText}
            onChange={(e) => setEnrollmentText(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-[#d6d6d6] bg-white text-[15px] text-[#111] focus:outline-none focus:border-[#07c160]"
            placeholder="请输入录入文本"
          />
        </div>

        {/* 声纹档案名称 */}
        <div className="w-full max-w-[320px] mb-8">
          <label className="block text-[13px] text-[#999] mb-2">
            声纹档案名称 <span className="text-[#ff4d4f]">*</span>
          </label>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-[#d6d6d6] bg-white text-[15px] text-[#111] focus:outline-none focus:border-[#07c160]"
            placeholder="例如：我的声纹"
          />
        </div>

        {/* 开始录入按钮 */}
        <button
          type="button"
          onClick={() => setStep("recording")}
          disabled={!profileName.trim()}
          className="w-full max-w-[320px] h-11 rounded-lg bg-[#07c160] text-white text-[17px] font-medium hover:bg-[#06ad56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          开始录入
        </button>
      </div>
    </div>
  );

  // 渲染录制页面
  const renderRecording = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-col items-center justify-center h-full">
        {/* 进度指示 */}
        <div className="mb-8 text-center">
          <div className="text-[15px] text-[#999] mb-2">
            第 {recordedSamples.length + 1} 次，共 {totalSamples} 次
          </div>
          <div className="flex gap-2 justify-center">
            {Array.from({ length: totalSamples }).map((_, index) => (
              <div
              key={index}
              className={`w-2 h-2 rounded-full ${
                index < recordedSamples.length
                  ? "bg-[#07c160]"
                  : "bg-[#d6d6d6]"
              }`}
            />
          ))}
          </div>
        </div>

        {/* 文本显示 */}
        <div className="w-full max-w-[320px] bg-white rounded-lg p-4 mb-12">
          <div className="text-[15px] text-[#111] text-center">
            请朗读：{enrollmentText}
          </div>
        </div>

        {/* 录音按钮 */}
        <div className="mb-8">
          <button
            type="button"
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
              isRecording
                ? "bg-[#ff4444] hover:bg-[#ee3333]"
                : "bg-[#07c160] hover:bg-[#06ad56]"
            }`}
          >
            {isRecording ? (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 bg-white rounded" />
                <span className="text-white text-[10px] mt-1">停止</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <span className="text-white text-[10px] mt-1">录音</span>
              </div>
            )}
          </button>
        </div>

        {/* 录制状态 */}
        {isRecording && (
          <div className="flex items-center gap-2 text-[#ff4444]">
            <div className="w-2 h-2 rounded-full bg-[#ff4444] animate-pulse" />
            <span className="text-[13px]">正在录制...</span>
          </div>
        )}

        {/* 提示 */}
        <p className="text-[13px] text-[#999] text-center mt-8">
          点击按钮开始录音，再次点击停止录音
        </p>
      </div>
    </div>
  );

  // 渲染回放确认页面
  const renderPlayback = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-col items-center justify-center h-full">
        {/* 标题 */}
        <h2 className="text-[20px] font-semibold text-[#111] mb-3">
          回放确认
        </h2>

        {/* 说明文本 */}
        <p className="text-[15px] text-[#666] text-center mb-8">
          请听取刚才的录制，确认是否使用此样本
        </p>

        {/* 播放按钮 */}
        <div className="mb-12">
          <button
            type="button"
            onClick={playAudio}
            className="w-20 h-20 rounded-full bg-[#07c160] flex items-center justify-center hover:bg-[#06ad56] transition-colors"
          >
            {isPlaying ? (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border-2 border-white rounded" />
                <span className="text-white text-[10px] mt-1">暂停</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="white"
                >
                  <polygon points="5,3 19,12 5,21" />
                </svg>
                <span className="text-white text-[10px] mt-1">播放</span>
              </div>
            )}
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-4 w-full max-w-[320px]">
          <button
            type="button"
            onClick={handleRerecord}
            className="flex-1 h-11 rounded-lg bg-[#f0f0f0] text-[15px] text-[#333] font-medium hover:bg-[#e0e0e0] transition-colors"
          >
            重录
          </button>
          <button
            type="button"
            onClick={handleConfirmSample}
            className="flex-1 h-11 rounded-lg bg-[#07c160] text-[15px] text-white font-medium hover:bg-[#06ad56] transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );

  // 渲染成功页面
  const renderSuccess = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-col items-center justify-center h-full">
        {/* 成功图标 */}
        <div className="w-20 h-20 rounded-full bg-[#07c160] flex items-center justify-center mb-6">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        {/* 标题 */}
        <h2 className="text-[20px] font-semibold text-[#111] mb-3">
          录入成功
        </h2>

        {/* 说明文本 */}
        <p className="text-[15px] text-[#666] text-center mb-8 max-w-[280px]">
          声纹已成功录入，可用于后续对话中的说话人识别
        </p>

        {/* 提交按钮 */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full max-w-[320px] h-11 rounded-lg bg-[#07c160] text-white text-[17px] font-medium hover:bg-[#06ad56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "提交中..." : "完成"}
        </button>
      </div>
    </div>
  );

  // 渲染当前步骤
  const renderStep = () => {
    switch (step) {
      case "guide":
        return renderGuide();
      case "recording":
        return renderRecording();
      case "playback":
        return renderPlayback();
      case "success":
        return renderSuccess();
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#ededed] w-full max-w-lg h-full max-h-[90vh] rounded-lg overflow-hidden flex flex-col">
        {/* 顶部导航栏 */}
        <header className="h-12 flex items-center px-3 bg-[#ededed] border-b border-[#d6d6d6]">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#d6d6d6] transition-colors"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#111"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="flex-1 text-center font-medium text-[17px]">
            声纹录入
          </span>
          <div className="w-8" />
        </header>

        {/* 步骤指示器 */}
        <div className="px-6 py-3 bg-white border-b border-[#d6d6d6]">
          <div className="flex items-center justify-center gap-2">
            <div
              className={`px-3 py-1 rounded-full text-[13px] ${
                step === "guide"
                  ? "bg-[#07c160] text-white"
                  : "bg-[#f0f0f0] text-[#999]"
              }`}
            >
              1. 引导
            </div>
            <div className="w-4 h-[1px] bg-[#d6d6d6]" />
            <div
              className={`px-3 py-1 rounded-full text-[13px] ${
                step === "recording" || step === "playback"
                  ? "bg-[#07c160] text-white"
                  : "bg-[#f0f0f0] text-[#999]"
              }`}
            >
              2. 录制
            </div>
            <div className="w-4 h-[1px] bg-[#d6d6d6]" />
            <div
              className={`px-3 py-1 rounded-full text-[13px] ${
                step === "success"
                  ? "bg-[#07c160] text-white"
                  : "bg-[#f0f0f0] text-[#999]"
              }`}
            >
              3. 完成
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        {renderStep()}

        {/* 错误提示 */}
        {localError && (
          <div className="px-6 py-3 bg-[#fff2f0] border-t border-[#ffccc7]">
            <p className="text-[13px] text-[#ff4d4f] text-center">
              {localError}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
