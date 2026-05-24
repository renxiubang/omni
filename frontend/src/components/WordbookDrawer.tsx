// Wordbook drawer component - slides in from the left

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { getWordbook, deleteWord, type WordbookItem } from "../api/wordbookApi";

interface WordbookDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function WordbookDrawer({ visible, onClose }: WordbookDrawerProps) {
  const { currentUser } = useAuth();
  const [words, setWords] = useState<WordbookItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Load wordbook data when drawer opens
  const loadWordbook = useCallback(async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await getWordbook(currentUser.id);
      setWords(data);
    } catch (err) {
      console.error("Failed to load wordbook:", err);
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (visible && currentUser) {
      loadWordbook();
    }
  }, [visible, currentUser, loadWordbook]);

  // Handle delete word
  const handleDelete = async (wordId: number) => {
    if (!currentUser) return;
    try {
      await deleteWord(wordId, currentUser.id);
      setWords((prev) => prev.filter((w) => w.id !== wordId));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete word:", err);
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* 抽屉面板 - 从左侧滑入 */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-full max-w-lg z-50 bg-[#ededed] shadow-xl transition-transform duration-300 ease-out flex flex-col ${
          visible ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex items-center h-12 px-3 bg-[#ededed] border-b border-[#d6d6d6] shrink-0">
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="flex-1 text-center font-medium text-[17px] text-[#111]">
            我的单词本
          </span>
          <div className="w-8" />
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-[#999] text-[14px]">
              加载中...
            </div>
          ) : error ? (
            <div className="m-4 p-4 bg-[#fff2f0] text-[#ff4d4f] text-[14px] rounded-[8px]">
              {error}
              <button
                onClick={loadWordbook}
                className="ml-2 underline text-[#07c160]"
              >
                重试
              </button>
            </div>
          ) : words.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#999]">
              <div className="text-[48px] mb-4">📝</div>
              <div className="text-[15px] mb-2">暂无收藏的单词</div>
              <div className="text-[13px] text-[#ccc]">
                在聊天中选中单词即可添加
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0f0]">
              {words.map((word) => (
                <div key={word.id} className="bg-white px-4 py-3">
                  {/* Word and phonetic */}
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <span className="text-[16px] font-semibold text-[#111]">
                        {word.word}
                      </span>
                      {(word.phonetic_uk || word.phonetic_us) && (
                        <span className="ml-2 text-[12px] text-[#999]">
                          {word.phonetic_uk && (
                            <span>英 {word.phonetic_uk}</span>
                          )}
                          {word.phonetic_uk && word.phonetic_us && (
                            <span className="mx-1">/</span>
                          )}
                          {word.phonetic_us && (
                            <span>美 {word.phonetic_us}</span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Delete button */}
                    {deleteConfirmId === word.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDelete(word.id)}
                          className="text-[12px] text-[#ff4d4f] font-medium px-1 hover:underline"
                        >
                          删除
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="text-[12px] text-[#999] px-1 hover:underline"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirmId(word.id)}
                        className="w-6 h-6 flex items-center justify-center text-[#ff4d4f] hover:bg-[#fff2f0] rounded transition-colors shrink-0"
                        aria-label="删除"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
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

                  {/* Date */}
                  <div className="mt-2">
                    <span className="text-[12px] text-[#999]">
                      {formatDate(word.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
