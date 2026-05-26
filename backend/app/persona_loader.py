"""
人格配置加载模块。
从 personas.yaml 加载英语对话练习的人格定义。
"""

from pathlib import Path
from typing import Any

import yaml


class Persona:
    def __init__(self, key: str, data: dict[str, Any]) -> None:
        self.key: str = key
        self.name: str = data["name"]
        self.description: str = data["description"]
        self.voice: str = data.get("voice", "Tina")
        self.difficulty: str = data.get("difficulty", "intermediate")
        self.system_prompt: str = data["system_prompt"].strip()


class PersonaStore:
    def __init__(self) -> None:
        self._personas: dict[str, Persona] = {}
        self._default_key: str = "english_teacher"
        self._call_prompts: dict[str, str] = {}

    def load(self, path: str | Path) -> None:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        self._default_key = data.get("default_persona", "english_teacher")
        for key, pdata in data.get("personas", {}).items():
            self._personas[key] = Persona(key, pdata)
        # 加载通话级别提示词
        raw_call_prompts = data.get("call_prompts", {})
        if isinstance(raw_call_prompts, dict):
            self._call_prompts = {k: str(v).strip() for k, v in raw_call_prompts.items()}

    def get(self, key: str | None = None) -> Persona:
        key = key or self._default_key
        if key not in self._personas:
            key = self._default_key
        return self._personas[key]

    def list_all(self) -> list[Persona]:
        return list(self._personas.values())

    def get_call_prompt(self, key: str) -> str:
        """获取通话级别的附加提示词，不存在则返回空字符串。"""
        return self._call_prompts.get(key, "")

    @property
    def default_key(self) -> str:
        return self._default_key


persona_store = PersonaStore()
