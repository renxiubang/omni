import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { VoicePrintEnroll } from "../components/VoicePrintEnroll";
import { useVoicePrint } from "../hooks/useVoicePrint";
import type { PersonaInfo } from "../api/client";

const STORAGE_KEY = "omni_speech_rate";
const DEFAULT_RATE = 1.0;
const STORAGE_KEY_TRAINING = "omni_wordbook_training";
const STORAGE_KEY_VOICE_DISABLED = "omni_voice_disabled";
const STORAGE_KEY_VOICEPRINT = "omni_voiceprint_enabled";

function loadRate(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseFloat(v);
      if (n >= 0.5 && n <= 2.0) return n;
    }
  } catch {}
  return DEFAULT_RATE;
}

function saveRate(rate: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {}
}

const PRESETS = [
  { label: "慢速", value: 0.75 },
  { label: "正常", value: 1.0 },
  { label: "快速", value: 1.25 },
];

interface SettingsDrawerProps {
  visible: boolean;
  onClose: () => void;
  personas: PersonaInfo[];
  selectedPersona: string;
  onChangePersona: (personaKey: string) => Promise<void>;
}

export function SettingsDrawer({ visible, onClose, personas, selectedPersona, onChangePersona }: SettingsDrawerProps) {
  const [rate, setRate] = useState(loadRate);
  const [wordbookTraining, setWordbookTraining] = useState(
    () => localStorage.getItem(STORAGE_KEY_TRAINING) === "true",
  );
  const [voiceDisabled, setVoiceDisabled] = useState(
    () => localStorage.getItem(STORAGE_KEY_VOICE_DISABLED) === "true",
  );
  const [voiceprintEnabled, setVoiceprintEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEY_VOICEPRINT) === "true",
  );
  const { logout, currentUser } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);

  // 使用 useVoicePrint Hook
  const {
    voiceProfiles,
    isLoading,
    error: _error,
    fetchVoiceProfiles,
    deleteVoiceProfile,
  } = useVoicePrint(currentUser?.id || 0);

  // 每次打开时从 localStorage 重新加载，并获取声纹档案列表
  useEffect(() => {
    if (visible) {
      setRate(loadRate());
      if (currentUser?.id) {
        fetchVoiceProfiles();
      }
    }
  }, [visible, currentUser?.id, fetchVoiceProfiles]);

  // 每次打开时从 localStorage 重新加载
  useEffect(() => {
    if (visible) setRate(loadRate());
  }, [visible]);

  const handleChange = useCallback((v: number) => {
    setRate(v);
    saveRate(v);
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    setShowLogoutConfirm(false);
    logout();
    onClose();
    // Redirect to login page
    window.location.href = "/login";
  }, [logout, onClose]);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* 抽屉面板 */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-full max-w-lg z-50 bg-[#ededed] shadow-xl transition-transform duration-300 ease-out ${
          visible ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* 顶部导航栏 */}
        <header className="h-12 flex items-center px-3 bg-[#ededed] border-b border-[#d6d6d6]">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#d6d6d6] transition-colors"
            onClick={onClose}
            aria-label="返回"
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="flex-1 text-center font-medium text-[17px]">
            设置
          </span>
          <div className="w-8" />
        </header>

        {/* 设置项 */}
        <div className="mx-3 mt-3 bg-white rounded-lg p-4">
          {/* 语速标签 + 当前值 */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[15px] text-[#111]">播放语速</span>
            <span className="text-[15px] text-[#07c160] font-medium tabular-nums">
              {rate.toFixed(2)}x
            </span>
          </div>

          {/* 滑块 */}
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={rate}
            className="w-full cursor-pointer"
            style={{ accentColor: "#07c160" }}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
          />

          {/* 预设按钮 */}
          <div className="flex gap-2 mt-3">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`flex-1 h-8 rounded-full text-[13px] font-medium transition-colors ${
                  Math.abs(rate - p.value) < 0.01
                    ? "bg-[#07c160] text-white"
                    : "bg-[#f0f0f0] text-[#333] hover:bg-[#e0e0e0]"
                }`}
                onClick={() => handleChange(p.value)}
              >
                {p.label} {p.value.toFixed(2)}x
              </button>
            ))}
          </div>
        </div>

        {/* 单词本训练 */}
        <div className="mx-3 mt-3 bg-white rounded-lg p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[15px] text-[#111]">单词本训练</span>
            <input
              type="checkbox"
              className="w-5 h-5 rounded accent-[#07c160] cursor-pointer"
              checked={wordbookTraining}
              onChange={(e) => {
                const v = e.target.checked;
                setWordbookTraining(v);
                localStorage.setItem(STORAGE_KEY_TRAINING, String(v));
              }}
            />
          </label>
          <p className="text-[12px] text-[#999] mt-2 leading-relaxed">
            开启后，AI 输出的语音和文本将仅限基础词汇和您的单词本
          </p>
        </div>

        {/* 屏蔽语音输出 */}
        <div className="mx-3 mt-3 bg-white rounded-lg p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[15px] text-[#111]">仅文字对话</span>
            <input
              type="checkbox"
              className="w-5 h-5 rounded accent-[#07c160] cursor-pointer"
              checked={voiceDisabled}
              onChange={(e) => {
                const v = e.target.checked;
                setVoiceDisabled(v);
                localStorage.setItem(STORAGE_KEY_VOICE_DISABLED, String(v));
              }}
            />
          </label>
          <p className="text-[12px] text-[#999] mt-2 leading-relaxed">
            开启后，不输出语音，仅显示文字
          </p>
        </div>

        {/* 人格选择 */}
        <div className="mx-3 mt-3 bg-white rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-[#111]">对话角色</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {personas.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`px-4 h-8 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                  selectedPersona === p.key
                    ? "bg-[#07c160] text-white"
                    : "bg-[#f0f0f0] text-[#333] hover:bg-[#e0e0e0]"
                }`}
                onClick={() => onChangePersona(p.key)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* 声纹验证开关 */}
        <div className="mx-3 mt-3 bg-white rounded-lg p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[15px] text-[#111]">声纹验证</span>
            <input
              type="checkbox"
              className="w-5 h-5 rounded accent-[#07c160] cursor-pointer"
              checked={voiceprintEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                setVoiceprintEnabled(v);
                localStorage.setItem(STORAGE_KEY_VOICEPRINT, String(v));
              }}
            />
          </label>
          <p className="text-[12px] text-[#999] mt-2 leading-relaxed">
            开启后，通话中将识别当前说话人，未匹配则不会回复
          </p>
        </div>

        {/* 声纹管理区域 */}
        <div className="mx-3 mt-3 bg-white rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f0f0]">
            <h3 className="text-[15px] font-medium text-[#111]">声纹管理</h3>
          </div>

          {/* 声纹档案列表 */}
          {isLoading ? (
            <div className="px-4 py-8 text-center text-[13px] text-[#999]">
              加载中...
            </div>
          ) : voiceProfiles.length > 0 ? (
            <div>
              {voiceProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0] last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] text-[#111] truncate">
                      {profile.name}
                    </div>
                    <div className="text-[12px] text-[#999] mt-1">
                      {new Date(profile.created_at).toLocaleDateString("zh-CN")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`确定要删除声纹档案"${profile.name}"吗？`)) {
                        deleteVoiceProfile(profile.id);
                      }
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#fff2f0] transition-colors"
                    aria-label="删除"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#ff4d4f"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-[#999]">
              暂无声纹档案
            </div>
          )}

          {/* 录入新声纹按钮 */}
          <button
            type="button"
            onClick={() => setShowEnroll(true)}
            className="w-full px-4 py-3 text-[15px] text-[#07c160] hover:bg-[#f6f6f6] transition-colors"
          >
            + 录入新声纹
          </button>
        </div>

        {/* 退出登录按钮 */}
        <div className="mx-3 mt-3 bg-white rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full px-4 py-3 text-[15px] text-[#ff4d4f] text-left hover:bg-[#fff2f0] transition-colors"
          >
            退出登录
          </button>
        </div>

        {/* 声纹录入组件 */}
        {showEnroll && currentUser?.id && (
          <VoicePrintEnroll
            userId={currentUser.id}
            onClose={() => {
              setShowEnroll(false);
              fetchVoiceProfiles();
            }}
            onSuccess={() => {
              setShowEnroll(false);
              fetchVoiceProfiles();
            }}
          />
        )}

        {/* 退出登录确认弹窗 */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 max-w-[280px] w-full mx-4">
              <div className="text-[17px] font-medium text-[#111] mb-2 text-center">
                确定要退出登录吗？
              </div>
              <div className="text-[13px] text-[#999] mb-6 text-center">
                退出后需要重新登录
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 h-10 rounded-lg bg-[#f0f0f0] text-[15px] text-[#333] hover:bg-[#e0e0e0] transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-1 h-10 rounded-lg bg-[#ff4d4f] text-[15px] text-white hover:bg-[#ff3333] transition-colors"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
