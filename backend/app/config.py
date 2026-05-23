from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    omni_model: str = "qwen3.5-omni-flash"
    omni_voice: str = "Tina"
    omni_audio_format: str = "pcm16"
    asr_model: str = "paraformer-v2"
    cors_origins: str = "http://localhost:5173"
    max_audio_history_turns: int = 3
    default_persona: str = "english_teacher"
    personas_path: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
