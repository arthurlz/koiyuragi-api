// src/app/api/analyze/route.ts
export const runtime = 'nodejs';            // 需要 Sharp & Tesseract，放 Node λ

import { NextResponse, NextRequest } from 'next/server';
import sharp from 'sharp';
import { join } from 'path';
import Tesseract from 'tesseract.js';
import { Message, streamObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

/* 1) GPT 输出结构 */
const Reply = z.object({
  empathy: z.string(),
  analysis: z.string(),
  suggestion: z.object({
    strategy: z.enum(['保持距离', '等待时机', '主动沟通']),
    message: z.string()
  })
});

const fewShots: Omit<Message, 'id'>[] = [
  {
    role: 'assistant',
    content: JSON.stringify({
      empathy: "既読スルーが続くと、胸がソワソワしますよね🌸",
      analysis: "・相手が忙しく返信のタイミングを探している可能性\n・メッセージ内容を熟考している途中かもしれません",
      suggestion: {
        strategy: "待機タイミング",
        message: "お疲れさま！無理しないでね😊"
      }
    })
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      empathy: "短い返事ばかりだと、距離を感じてしまいますよね✨",
      analysis: "・疲れていて深い返信が難しい\n・会話のテーマが相手に合っていない可能性",
      suggestion: {
        strategy: "率直に伝える",
        message: "最近どう？何か楽しいことあった？😌"
      }
    })
  }
];

const worker = await Tesseract.createWorker('jpn+eng');

// , 1, {
//   workerPath: join(process.cwd(),'node_modules/tesseract.js/dist/worker.min.js'),
//   langPath:  join(process.cwd(),'node_modules/tesseract.js-core/tessdata'),
//   corePath:  join(process.cwd(),'node_modules/tesseract.js-core/tesseract-core.wasm.gz'),
//   cacheMethod:'none'
// }

/* 2) API 入口 */
export async function POST(req: NextRequest) {
  /* 2-1 解析 multipart (仅需一行) */
  const form = await req.formData();
  const file = form.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }

  /* 2-2 将 File 转 Buffer */
  const inputBuf = Buffer.from(await file.arrayBuffer());

  /* 2-3 预处理：缩小宽度到 1080px + 灰度 */
  const preBuf = await sharp(inputBuf)
    .resize({ width: 1080 })
    .grayscale()
    .toBuffer();

  /* 2-4 OCR：小量图片本地跑 tesseract.js 即可 */
  const { data: { text } } = await worker.recognize(preBuf);
  console.log(text);
  /* 2-5 GPT-4o 三段式分析（streamObject 带增量、结构校验） */
  const stream = await streamObject({
    model: openai('gpt-4o'),
    schema: Reply,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          'あなたは《恋ゆらぎ》アプリの “癒やし系 AI カウンセラー” です。，请阅读用户上传的聊天文字，并输出 JSON：{ empathy, analysis, suggestion }'
      },
      ...fewShots,
      {
        role: 'user',
        content: `以下はチャットの文字起こしです：\n${text}\n\n相手の行動を分析し、励ましとアドバイスをください。`
      }
    ]
  });


  /* 2-6 把 ReadableStream 原样返回，前端边到边渲染 */
  // return new Response(stream, { headers:{ 'Content-Type':'text/event-stream' }});
  let full: string | null = null;   
  for await (const chunk of stream.partialObjectStream) {
    // 每个 chunk 都是 “最新合并后的对象”
    // console.log(chunk);
    full = JSON.stringify(chunk);
  }

  return NextResponse.json(full);
}
