/** Wordbook API client for Omni Chat application. */

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface WordbookItem {
    id: number;
    user_id: number;
    word: string;
    phonetic_uk: string;
    phonetic_us: string;
    explanation: string;
    example_sentence_en: string;
    example_sentence_zh: string;
    created_at: string;
}

export interface WordExplainResult {
    word: string;
    phonetic_uk: string;
    phonetic_us: string;
    explanation: string;
    example_sentence_en: string;
    example_sentence_zh: string;
}

/**
 * Get user's wordbook list
 */
export async function getWordbook(userId: number): Promise<WordbookItem[]> {
    const res = await fetch(`${API_BASE}/api/wordbook/list?user_id=${userId}`);
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to load wordbook");
    }
    return res.json();
}

/**
 * Delete a word from wordbook
 */
export async function deleteWord(wordId: number, userId: number): Promise<void> {
    const res = await fetch(
        `${API_BASE}/api/wordbook/${wordId}?user_id=${userId}`,
        { method: "DELETE" }
    );
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to delete word");
    }
}

/**
 * Add a word to wordbook
 */
export async function addWord(data: {
    user_id: number;
    word: string;
    phonetic_uk?: string;
    phonetic_us?: string;
    explanation?: string;
    example_sentence_en?: string;
    example_sentence_zh?: string;
}): Promise<WordbookItem> {
    const res = await fetch(`${API_BASE}/api/wordbook/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to add word");
    }
    return res.json();
}

/**
 * Get word explanation from LLM
 */
export async function explainWord(word: string): Promise<WordExplainResult> {
    const res = await fetch(`${API_BASE}/api/wordbook/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to explain word");
    }
    return res.json();
}

/**
 * Get word pronunciation audio
 */
export async function pronounceWord(word: string, voice?: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/api/wordbook/pronounce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, voice }),
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to generate pronunciation");
    }
    return res.blob();
}
