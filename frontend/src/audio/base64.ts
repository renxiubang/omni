/**
 * 二进制安全的 Base64 编解码。
 * 不依赖 btoa/atob 的二进制字符串 hack，直接操作 Uint8Array。
 */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < CHARS.length; i++) LOOKUP[CHARS.charCodeAt(i)] = i;

/** 将 Uint8Array 编码为 Base64 字符串 */
export function encodeBase64(bytes: Uint8Array): string {
  let result = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += CHARS[b1 >> 2];
    result += CHARS[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? CHARS[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    result += i + 2 < len ? CHARS[b3 & 63] : "=";
  }
  return result;
}

/** 将 Base64 字符串解码为 Uint8Array */
export function decodeBase64(base64: string): Uint8Array {
  const str = base64.replace(/=+$/, "");
  const len = str.length;
  const outLen = Math.floor((len * 3) / 4);
  const bytes = new Uint8Array(outLen);

  let byteIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = LOOKUP[str.charCodeAt(i)];
    const c2 = LOOKUP[str.charCodeAt(i + 1)];
    const c3 = i + 2 < len ? LOOKUP[str.charCodeAt(i + 2)] : 64;
    const c4 = i + 3 < len ? LOOKUP[str.charCodeAt(i + 3)] : 64;

    bytes[byteIdx++] = (c1 << 2) | (c2 >> 4);
    if (c3 < 64) bytes[byteIdx++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (c4 < 64) bytes[byteIdx++] = ((c3 & 3) << 6) | c4;
  }
  return bytes;
}
