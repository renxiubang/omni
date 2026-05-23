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
    # DashScope omni 模型输出的原始音频采样率 (Hz)
    dashscope_audio_sample_rate: int = 24000
    # 统一输出采样率，与前端麦克风 AudioContext 一致 (Hz)
    output_sample_rate: int = 24000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
