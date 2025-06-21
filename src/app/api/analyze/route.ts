// src/app/api/analyze/route.ts
export const runtime = 'nodejs';            // 需要 Sharp & Tesseract，放 Node λ

import { NextResponse, NextRequest } from 'next/server';
import { join } from 'path';
import fs from 'fs'
import { generateText, Message, streamObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { supabase } from '@/app/lib/supabase';
import { createFileSha256 } from '@/app/lib/files';


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


const bucketName = 'documents'

/* 2) API 入口 */
export async function POST(req: NextRequest) {
  /* 2-1 解析 multipart (仅需一行) */
  const form = await req.formData();
  const file = form.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'no file' }, { status: 400 });
  }
  const fileName = await createFileSha256(file)
  const { data, error: errorGet } = await supabase
  .storage
  .getBucket(bucketName)
  if (errorGet?.status === 404) {
    const { data: dataCreate, error } = await supabase
    .storage
    .createBucket(bucketName, {
      public: false,
      // allowedMimeTypes: ['image/png'],
      // fileSizeLimit: 1024
    })
    console.log('bucket: ', dataCreate, error)
  }
  
  const filePath = `uploads/${fileName}`
  const { data: items, error: listError } = await supabase
    .storage
    .from(bucketName)
    .list('uploads/', { search: fileName });
  console.log('list: ,', items)
  if (listError) {
    console.error('列举目录失败：', listError);
  } else if (items.some(item => item.name === fileName)) {
    // 找到同名
    console.log('文件已存在，不再上传：', filePath);
  } else {
    // 2) 真正上传
    const { data: uploadData, error } = await supabase
    .storage
    .from(bucketName)
    .upload(filePath, file);
    if (error) {
      if (error.message.includes('cannot overwrite existing file')) {
        // 已经存在
        console.log('文件已存在，不再上传：', filePath);
        // 你可以 return 已有 public URL，或返回特定状态码
      } else {
        // 其他错误
        console.error('上传失败：', error);
        throw error;
      }
    }
  }
  
  // const publicUrl = supabase
  //   .storage
  //   .from(bucketName)
  //   .getPublicUrl(filePath)
  //   .data.publicUrl;
  const signedData = await supabase
  .storage
  .from(bucketName)
  .createSignedUrl(filePath, 10);
  if (!signedData.data?.signedUrl) {
    throw new Error('can not create signed url');
  }
	const { text: cleanText } = await generateText({
		model: openai('gpt-4o'),
		// prompt: ``,
		system: 'あなたは画像内のチャットスクリーンショットから、発言者ごとに区切って会話内容をテキスト化するプロフェッショナルなOCRアシスタントです。',
    messages: [
      {
        role: 'user',
        content: [{
          type: 'text',
          text: `以下の画像に含まれるチャットメッセージを、発言者ごとに区切って、
            送信順に1行ずつテキストとして抽出してください。
            
            例：
            ユーザー: こんにちは！
            AI: ご相談内容を教えてください。
            
            ――――――――――――――――――
            【ここに画像を添付】`
        },
          {
          type: 'image',
          image: signedData.data?.signedUrl
        }]
      }
    ]
    // messages: [
    //   {
    //     role: 'user',
    //     content: [
    //       {
    //         type: 'image',
    //         image: fs.readFileSync(file).toString('base64'),
    //       },
    //     ],
    //   },
    // ],
	});

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
        content: `以下はチャットの文字起こしです：\n${cleanText}\n\n相手の行動を分析し、励ましとアドバイスをください。`
      }
    ]
  });


  /* 2-6 把 ReadableStream 原样返回，前端边到边渲染 */
  // return new Response(stream, { headers:{ 'Content-Type':'text/event-stream' }});
  let full = null;   
  for await (const chunk of stream.partialObjectStream) {
    // 每个 chunk 都是 “最新合并后的对象”
    full = chunk;
  }

  return NextResponse.json(full);
}
