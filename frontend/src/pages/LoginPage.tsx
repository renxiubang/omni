// Login page component for Omni Chat application.

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
    const [username, setUsername] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { login, isLoading } = useAuth();
    const navigate = useNavigate();

    // Auto-focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const trimmedUsername = username.trim();
        
        // Validate input
        if (!trimmedUsername) {
            setError("请输入用户名");
            return;
        }
        
        if (trimmedUsername.length < 1 || trimmedUsername.length > 50) {
            setError("用户名长度需要在1-50个字符之间");
            return;
        }
        
        if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
            setError("用户名只能包含字母、数字和下划线");
            return;
        }
        
        setError("");
        setIsSubmitting(true);
        
        try {
            await login(trimmedUsername);
            navigate("/"); // Redirect to chat page
        } catch (err) {
            setError(err instanceof Error ? err.message : "登录失败，请重试");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle Enter key press
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isSubmitting) {
            handleSubmit(e as unknown as React.FormEvent);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] px-4">
            <div className="w-full max-w-[400px] bg-white rounded-[12px] shadow-lg p-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="text-6xl mb-4">🤖</div>
                    <h1 className="text-[24px] font-semibold text-[#111]">
                        Omni Chat
                    </h1>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Username Input */}
                    <div>
                        <input
                            ref={inputRef}
                            type="text"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setError(""); // Clear error on input change
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="请输入用户名"
                            className="w-full h-[44px] px-4 rounded-[8px] border border-[#e0e0e0] 
                                     text-[15px] text-[#111] placeholder-[#999] 
                                     focus:outline-none focus:border-[#07c160] focus:ring-1 focus:ring-[#07c160]
                                     transition-colors"
                            disabled={isSubmitting || isLoading}
                            maxLength={50}
                        />
                        <p className="mt-2 text-[12px] text-[#999]">
                            无需密码，输入用户名即可登录
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="text-[14px] text-[#ff4d4f] bg-[#fff2f0] rounded-[8px] px-4 py-3">
                            {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isSubmitting || isLoading}
                        className="w-full h-[44px] bg-[#07c160] text-white text-[15px] font-medium 
                                 rounded-[8px] hover:bg-[#06ad56] active:bg-[#059a4c]
                                 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                 cursor-pointer"
                    >
                        {isSubmitting || isLoading ? "登录中..." : "进入聊天"}
                    </button>
                </form>
            </div>
        </div>
    );
}
