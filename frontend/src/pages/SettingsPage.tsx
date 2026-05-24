import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const STORAGE_KEY = "omni_speech_rate";
const DEFAULT_RATE = 1.0;

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
}

export function SettingsDrawer({ visible, onClose }: SettingsDrawerProps) {
  const [rate, setRate] = useState(loadRate);
  const { logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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
