/** Word explanation popup component for Omni Chat application. */

import { useState, useEffect, useRef, useCallback } from "react";
import { explainWord, pronounceWord, addWord, type WordExplainResult } from "../api/wordbookApi";
import { useAuth } from "../context/AuthContext";

interface WordExplanationPopupProps {
    selectedText: string;
    position: { x: number; y: number };
    onClose: () => void;
}

export function WordExplanationPopup({
    selectedText,
    position,
    onClose,
}: WordExplanationPopupProps) {
    const { currentUser } = useAuth();
    const [explanation, setExplanation] = useState<WordExplainResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const [isInWordbook, setIsInWordbook] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // Load word explanation
    useEffect(() => {
        const loadExplanation = async () => {
            setIsLoading(true);
            setError("");
            
            try {
                const result = await explainWord(selectedText);
                setExplanation(result);
            } catch (err) {
                console.error("Failed to explain word:", err);
                setError(err instanceof Error ? err.message : "解释失败");
            } finally {
                setIsLoading(false);
            }
        };

        loadExplanation();
    }, [selectedText]);

    // Close on ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        // Delay to avoid immediate closing
        setTimeout(() => {
            window.addEventListener("mousedown", handleClickOutside);
        }, 100);

        return () => window.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    // Play pronunciation
    const handlePlayPronunciation = useCallback(async () => {
        if (isPlaying) {
            // Stop playing
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            setIsPlaying(false);
            return;
        }

        try {
            setIsPlaying(true);
            const audioBlob = await pronounceWord(selectedText);
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            audioRef.current = audio;
            
            audio.onended = () => {
                setIsPlaying(false);
                URL.revokeObjectURL(audioUrl);
                audioRef.current = null;
            };
            
            audio.onerror = () => {
                setIsPlaying(false);
                URL.revokeObjectURL(audioUrl);
                audioRef.current = null;
            };
            
            await audio.play();
        } catch (err) {
            console.error("Failed to play pronunciation:", err);
            setIsPlaying(false);
        }
    }, [selectedText, isPlaying]);

    // Add to wordbook
    const handleAddToWordbook = useCallback(async () => {
        if (!currentUser || !explanation) return;
        
        try {
            await addWord({
                user_id: currentUser.id,
                word: selectedText,
                phonetic_uk: explanation.phonetic_uk,
                phonetic_us: explanation.phonetic_us,
                explanation: explanation.explanation,
                example_sentence_en: explanation.example_sentence_en,
                example_sentence_zh: explanation.example_sentence_zh,
            });
            
            setIsInWordbook(true);
            setShowToast(true);
            
            // Hide toast after 3 seconds
            setTimeout(() => setShowToast(false), 3000);
        } catch (err) {
            console.error("Failed to add word to wordbook:", err);
            // Word might already exist
            if (err instanceof Error && err.message.includes("already")) {
                setIsInWordbook(true);
            }
        }
    }, [currentUser, selectedText, explanation]);

    // Adjust position to avoid overflow
    const adjustedPosition = useCallback(() => {
        const popupWidth = 320;
        const popupHeight = 300;
        const padding = 10;
        
        let { x, y } = position;
        
        // Adjust horizontal position
        if (x + popupWidth > window.innerWidth - padding) {
            x = window.innerWidth - popupWidth - padding;
        }
        if (x < padding) {
            x = padding;
        }
        
        // Adjust vertical position
        if (y + popupHeight > window.innerHeight - padding) {
            y = y - popupHeight - 20; // Show above selection
        }
        
        return { x, y };
    }, [position]);

    const finalPosition = adjustedPosition();

    return (
        <>
            {/* Overlay */}
            <div className="fixed inset-0 z-40" />
            
            {/* Popup */}
            <div
                ref={popupRef}
                className="fixed z-50 w-[320px] bg-white rounded-[12px] shadow-lg p-4 animate-fade-in"
                style={{
                    left: `${finalPosition.x}px`,
                    top: `${finalPosition.y}px`,
                }}
            >
                {/* Header with word and buttons */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                        <h3 className="text-[18px] font-semibold text-[#111]">
                            {selectedText}
                        </h3>
                        {(explanation?.phonetic_uk || explanation?.phonetic_us) && (
                            <div className="text-[13px] text-[#666] mt-1">
                                {explanation.phonetic_uk && <span>英 {explanation.phonetic_uk}</span>}
                                {explanation.phonetic_uk && explanation.phonetic_us && <span className="mx-2">/</span>}
                                {explanation.phonetic_us && <span>美 {explanation.phonetic_us}</span>}
                            </div>
                        )}
                    </div>
                    
                    {/* Star button */}
                    <button
                        onClick={handleAddToWordbook}
                        disabled={!currentUser || isInWordbook}
                        className="w-6 h-6 flex items-center justify-center hover:bg-[#f5f5f5] rounded transition-colors disabled:cursor-not-allowed"
                        aria-label="添加到单词本"
                    >
                        {isInWordbook ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#f5a623" stroke="#f5a623" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* Play pronunciation button */}
                <button
                    onClick={handlePlayPronunciation}
                    className="flex items-center gap-2 mb-3 text-[14px] text-[#07c160] hover:text-[#06ad56] transition-colors"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d={isPlaying ? "M15 9 L15 15 M19 7 L19 17" : "M15 9 L19 5 M19 5 L23 9 M19 5 L19 19 M19 19 L23 15 M15 15 L19 19"} />
                    </svg>
                    {isPlaying ? "停止播放" : "播放发音"}
                </button>

                {/* Loading state */}
                {isLoading && (
                    <div className="text-[14px] text-[#999] py-4 text-center">
                        加载中...
                    </div>
                )}

                {/* Error state */}
                {error && !isLoading && (
                    <div className="text-[14px] text-[#ff4d4f] py-4 text-center">
                        {error}
                    </div>
                )}

                {/* Explanation */}
                {!isLoading && !error && explanation && (
                    <div className="text-[14px] text-[#333] leading-[1.6] whitespace-pre-wrap">
                        {explanation.explanation}
                    </div>
                )}

                {/* Example sentence */}
                {!isLoading && !error && explanation?.example_sentence_en && (
                    <div className="mt-3 pt-3 border-t border-[#f0f0f0]">
                        <div className="text-[13px] text-[#666] italic">
                            {explanation.example_sentence_en}
                        </div>
                        {explanation.example_sentence_zh && (
                            <div className="text-[13px] text-[#999] mt-1">
                                {explanation.example_sentence_zh}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Toast */}
            {showToast && (
                <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#333] text-white text-[14px] px-4 py-2 rounded-[8px] shadow-lg">
                    已加入单词本
                </div>
            )}
        </>
    );
}
