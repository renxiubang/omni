"""
单词本训练模式 - 构建词汇约束指令

当用户启用"单词本训练"时，AI 输出限制在基础词汇 + 用户单词本范围内。
"""

import logging
from pathlib import Path

from app.db import get_user_wordbook

logger = logging.getLogger(__name__)


class WordbookTrainer:
    def __init__(self) -> None:
        self._basic_words: list[str] = []
        self._load_basic_words()

    def _load_basic_words(self) -> None:
        path = Path(__file__).parent.parent / "data" / "basic_words.md"
        if path.exists():
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
                words: list[str] = []
                for line in text.splitlines():
                    stripped = line.strip()
                    if not stripped or stripped.startswith("#"):
                        continue
                    # 逗号分隔解析
                    for part in stripped.split(","):
                        w = part.strip()
                        if w:
                            words.append(w)
                self._basic_words = words
                logger.info(
                    "Loaded %d basic words from %s", len(self._basic_words), path
                )
            except Exception as e:
                logger.warning("Failed to load basic words: %s", e)
        else:
            logger.warning("basic_words.md not found at %s", path)

    @property
    def basic_word_count(self) -> int:
        return len(self._basic_words)

    def get_user_words(self, user_id: int) -> list[str]:
        """获取用户单词本中的单词（小写）。"""
        try:
            words = get_user_wordbook(user_id)
            return [w["word"].lower().strip() for w in words if w.get("word")]
        except Exception as e:
            logger.warning("Failed to load user wordbook for user %d: %s", user_id, e)
            return []

    def build_constraint_instruction(self, user_id: int | None = None) -> str:
        """构建词汇约束指令，限制 AI 仅使用基础词汇 + 用户单词本。

        Args:
            user_id: 用户 ID，用于获取个性化单词本（可选）。

        Returns:
            约束指令字符串。若无可用词汇则返回空字符串。
        """
        # 保留原始大小写用于显示，用 lowercase 做去重匹配
        seen: set[str] = set()
        display_words: list[str] = []
        for w in self._basic_words:
            key = w.lower()
            if key not in seen:
                seen.add(key)
                display_words.append(w)
        if user_id:
            user_words = self.get_user_words(user_id)
            for w in user_words:
                key = w.lower()
                if key not in seen:
                    seen.add(key)
                    display_words.append(w)

        if not display_words:
            return ""

        word_list = ", ".join(sorted(display_words, key=lambda s: s.lower()))

        return (
            "You are in VOCABULARY TRAINING MODE. This is an ABSOLUTE constraint. "
            "Follow these rules or the user will be confused:\n\n"
            "1. For EVERY word you output, check if its base form is in the "
            "Approved Vocabulary list below.\n"
            "2. If a word's base form is NOT in the list, you MUST NOT use it.\n"
            "   - Allowed: swim, swims, swimming, swam, swum (base 'swim' is in list)\n"
            "   - Forbidden: difficult, task, necessary, however (base forms not in list)\n"
            "3. Keep sentences very short. Use only small, simple words.\n"
            "4. If you cannot express something, explain with words from the list.\n\n"
            f"Approved Vocabulary ({len(display_words)} words): {word_list}"
        )


wordbook_trainer = WordbookTrainer()
