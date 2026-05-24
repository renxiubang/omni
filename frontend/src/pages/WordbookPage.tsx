// Wordbook page component for Omni Chat application.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getWordbook, deleteWord, type WordbookItem } from "../api/wordbookApi";

export function WordbookPage() {
    const navigate = useNavigate();
    const { currentUser, isLoggedIn } = useAuth();
    const [words, setWords] = useState<WordbookItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

    // Redirect to login if not logged in
    useEffect(() => {
        if (!isLoggedIn) {
            navigate("/login");
        }
    }, [isLoggedIn, navigate]);

    // Load wordbook data
    const loadWordbook = useCallback(async () => {
        if (!currentUser) return;
        
        setIsLoading(true);
        setError("");
        
        try {
            const data = await getWordbook(currentUser.id);
            setWords(data);
        } catch (err) {
            console.error("Failed to load wordbook:", err);
            setError(err instanceof Error ? err.message : "Failed to load wordbook");
        } finally {
            setIsLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        if (currentUser) {
            loadWordbook();
        }
    }, [currentUser, loadWordbook]);

    // Handle delete word
    const handleDelete = async (wordId: number) => {
        try {
            await deleteWord(wordId, currentUser!.id);
            setWords(words.filter(w => w.id !== wordId));
            setDeleteConfirmId(null);
        } catch (err) {
            console.error("Failed to delete word:", err);
            setError(err instanceof Error ? err.message : "Failed to delete word");
        }
    };

    // Format date
    const formatDate = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
            });
        } catch {
            return dateStr;
        }
    };

    if (!currentUser) {
        return null;
    }

    return (
        <div className="flex flex-col h-screen max-w-[448px] mx-auto bg-[#ededed] shadow-lg">
            {/* Header */}
            <header className="flex items-center h-12 px-3 bg-[#ededed] border-b border-[#d6d6d6] shrink-0">
                {/* Back button */}
                <button
                    onClick={() => navigate("/")}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#d6d6d6] transition-colors"
                    aria-label="返回"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>

                {/* Title */}
                <span className="flex-1 text-center text-[17px] font-medium text-[#111]">
                    我的单词本
                </span>

                {/* Right spacer */}
                <div className="w-8" />
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    /* Loading state */
                    <div className="flex items-center justify-center h-32 text-[#999] text-[14px]">
                        加载中...
                    </div>
                ) : error ? (
                    /* Error state */
                    <div className="m-4 p-4 bg-[#fff2f0] text-[#ff4d4f] text-[14px] rounded-[8px]">
                        {error}
                    </div>
                ) : words.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center h-64 text-[#999]">
                        <div className="text-[48px] mb-4">📝</div>
                        <div className="text-[15px] mb-2">暂无收藏的单词</div>
                        <div className="text-[13px] text-[#ccc]">
                            在聊天中选中单词即可添加
                        </div>
                    </div>
                ) : (
                    /* Word list */
                    <div className="divide-y divide-[#f0f0f0]">
                        {words.map((word) => (
                            <div key={word.id} className="bg-white px-4 py-3">
                                {/* Word and phonetic */}
                                <div className="flex items-start justify-between mb-1">
                                    <div className="flex-1">
                                        <span className="text-[16px] font-semibold text-[#111]">
                                            {word.word}
                                        </span>
                                        {(word.phonetic_uk || word.phonetic_us) && (
                                            <span className="ml-2 text-[12px] text-[#999]">
                                                {word.phonetic_uk && <span>英 {word.phonetic_uk}</span>}
                                                {word.phonetic_uk && word.phonetic_us && <span className="mx-1">/</span>}
                                                {word.phonetic_us && <span>美 {word.phonetic_us}</span>}
                                            </span>
                                        )}
                                    </div>

                                    {/* Delete button */}
                                    <button
                                        onClick={() => setDeleteConfirmId(word.id)}
                                        className="w-6 h-6 flex items-center justify-center text-[#ff4d4f] hover:bg-[#fff2f0] rounded transition-colors"
                                        aria-label="删除"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Explanation */}
                                {word.explanation && (
                                    <div className="text-[14px] text-[#333] mb-1 whitespace-pre-wrap">
                                        {word.explanation}
                                    </div>
                                )}

                                {/* Example sentence */}
                                {word.example_sentence_en && (
                                    <div className="mt-1 italic text-[12px] text-[#666]">
                                        {word.example_sentence_en}
                                    </div>
                                )}
                                {word.example_sentence_zh && (
                                    <div className="text-[12px] text-[#999]">
                                        {word.example_sentence_zh}
                                    </div>
                                )}

                                {/* Date and delete confirmation */}
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-[12px] text-[#999]">
                                        {formatDate(word.created_at)}
                                    </span>

                                    {/* Delete confirmation */}
                                    {deleteConfirmId === word.id && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-[12px] text-[#ff4d4f]">
                                                确定删除？
                                            </span>
                                            <button
                                                onClick={() => handleDelete(word.id)}
                                                className="text-[12px] text-[#ff4d4f] font-medium hover:underline"
                                            >
                                                确定
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmId(null)}
                                                className="text-[12px] text-[#999] hover:underline"
                                            >
                                                取消
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
