import { createHash } from 'crypto';
import { createFileSha256 } from './createFileSha256';
import { supabase } from '@/app/lib/supabase';

const bucketName = 'documents';
/* ---------- 主流程 ---------- */
export async function uploadWithDedup(dataUrl: string) {
  const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  const contentType = m[1];          // image/png
  const base64 = m[2];               // AAAFB...
  const buffer = Buffer.from(base64, 'base64');

  // ② 计算 SHA256 做去重（可选）
  const sha = createHash('sha256').update(buffer).digest('hex');
  const ext = contentType.split('/')[1] || 'png';
  const fileName = `${sha}.${ext}`
  const filePath = `uploads/${fileName}`;

  /* 3. 检查同名文件是否已存在 */
  const { data: items, error: listErr } = await supabase
    .storage.from(bucketName)
    .list('uploads/', { search: fileName });

  if (listErr) throw listErr;

  if (items.length === 0) {
    console.log('start to upload')
    /* 4. 上传（upsert:false 防覆盖） */
    const { error: upErr } = await supabase
      .storage.from(bucketName)
      .upload(filePath, buffer, { upsert: false });

    if (upErr && !upErr.message.includes('exists')) throw upErr;
  }

  /* 5. 生成 10 秒签名 URL */
  const { data: sig, error: sigErr } = await supabase
    .storage.from(bucketName)
    .createSignedUrl(filePath, 10);

  if (sigErr || !sig?.signedUrl) throw sigErr ?? new Error('signedUrl missing');

  return { path: filePath, url: sig.signedUrl };
}
