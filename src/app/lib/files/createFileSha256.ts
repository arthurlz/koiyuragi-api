import crypto from 'crypto';

export async function createFileSha256(file: File) {
  // 1. 读成 ArrayBuffer，再转 Buffer
  const buf = Buffer.from(await file.arrayBuffer());

  // 2. 用 crypto 计算 SHA-256
  const hash = crypto
    .createHash('sha256')
    .update(buf)
    .digest('hex');    // 输出 64 位 16 进制字符串

  // 3. 拼成文件名（保留原始扩展名）
  const ext = file.name.split('.').pop();
  const filename = `${hash}.${ext}`;
  return filename
}
