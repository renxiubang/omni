const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface VoiceProfile {
  id: number;
  user_id: number;
  name: string;
  audio_samples: string[];
  enrollment_text: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceProfileListResponse {
  profiles: VoiceProfile[];
}

/**
 * 录入声纹
 * @param userId 用户ID
 * @param name 声纹档案名称
 * @param enrollmentText 录入时朗读的文本
 * @param audioSamples 音频样本文件数组（3-5个）
 * @returns 创建的声纹档案
 */
export async function enrollVoicePrint(
  userId: number,
  name: string,
  enrollmentText: string,
  audioSamples: File[]
): Promise<VoiceProfile> {
  const form = new FormData();
  form.append("user_id", userId.toString());
  form.append("name", name);
  form.append("enrollment_text", enrollmentText);

  audioSamples.forEach((file) => {
    form.append("audio_samples", file);
  });

  const res = await fetch(`${API_BASE}/api/voice-print/enroll`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "声纹录入失败");
  }

  return res.json();
}

/**
 * 获取用户的声纹档案列表
 * @param userId 用户ID
 * @returns 声纹档案列表
 */
export async function listVoiceProfiles(
  userId: number
): Promise<VoiceProfile[]> {
  const res = await fetch(
    `${API_BASE}/api/voice-print/list?user_id=${encodeURIComponent(userId)}`
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "获取声纹档案列表失败");
  }

  const data: VoiceProfileListResponse = await res.json();
  return data.profiles;
}

/**
 * 获取单个声纹档案详情
 * @param profileId 声纹档案ID
 * @param userId 用户ID（用于授权）
 * @returns 声纹档案详情
 */
export async function getVoiceProfile(
  profileId: number,
  userId: number
): Promise<VoiceProfile> {
  const res = await fetch(
    `${API_BASE}/api/voice-print/${profileId}?user_id=${encodeURIComponent(userId)}`
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "获取声纹档案失败");
  }

  return res.json();
}

/**
 * 删除声纹档案
 * @param profileId 声纹档案ID
 * @param userId 用户ID（用于授权）
 */
export async function deleteVoiceProfile(
  profileId: number,
  userId: number
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/voice-print/${profileId}?user_id=${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    }
  );

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "删除声纹档案失败");
  }
}

/**
 * 获取声纹音频样本URL
 * @param profileId 声纹档案ID
 * @param sampleIndex 音频样本索引（从0开始）
 * @param userId 用户ID（用于授权）
 * @returns 音频文件的URL
 */
export function getAudioSampleUrl(
  profileId: number,
  sampleIndex: number,
  userId: number
): string {
  return `${API_BASE}/api/voice-print/audio/${profileId}/${sampleIndex}?user_id=${encodeURIComponent(userId)}`;
}
