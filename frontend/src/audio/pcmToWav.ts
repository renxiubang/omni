/**
 * 将 base64 PCM16 数据块拼接并转为 WAV Blob，用于浏览器原生 Audio 回放。
 */
import { decodeBase64 } from "./base64";

export function pcm16Base64ToWavBlob(
  chunks: string[],
  sampleRate: number,
): Blob {
  // 逐块解码 base64 并拼接原始字节，避免 btoa/atob 二进制字符串兼容性问题
  const allBytes: number[] = [];
  for (const chunk of chunks) {
    const decoded = decodeBase64(chunk);
    for (let i = 0; i < decoded.length; i++) allBytes.push(decoded[i]);
  }
  const pcmBytes = new Uint8Array(allBytes);

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBytes.length;
  const headerSize = 44;

  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");

  // fmt sub-chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer).set(pcmBytes, headerSize);

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
