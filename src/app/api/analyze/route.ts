export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { generateText, Message, streamObject, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { uploadWithDedup } from '@/app/lib/files';
import { CHAT_PROMPT, ANALYSIS_PROMPT, fewShots } from './prompt';
import { createAuthDb } from '@/app/lib/supabase';
import { saveChat } from '@/app/lib/supabase/analyze';
import { loadChatByClientId } from '@/app/lib/supabase/loadChat';
import { getType } from '@/app/lib/utils';

/* 1) GPT 输出结构 */
const Reply = z.object({
  empathy: z.string(),
  analysis: z.string(),
  suggestion: z.string()
});

const hasImageAttachment = (m: Message) =>
  m.experimental_attachments?.some(a => a.contentType?.startsWith('image/'));

/* 2) API 入口 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer /, '');
  console.log('token: ', token)
  const supabase = createAuthDb(token ?? '')
  const { data: userData } = await supabase.auth.getUser(token);
  // console.log(userData)
  const data = await req.json();
  console.log(data)
  const { id, message, data: extra }: { id: string, message: Message; data?: any } = data;
  const userMsg = message.role === 'user';
  if (!userMsg) return new Response('no user message', { status: 400 });

  /* ---- 4.2 判断是否需要三段式分析 ---- */
  const wantsAnalysis =
    hasImageAttachment(message) ||
    extra?.mode === 'analyze' ||
    message.content.toString().trim().startsWith('#分析') ||
    message.content.toString().trim().startsWith('#analyze');

  if (!userData.user?.id) {
    return new Response('no user', { status: 401 });
  }
  let previousMessages: Array<{
    role: 'user' | 'assistant' | 'system' | 'data',
    content: string,
  }> | undefined = undefined
  try {
    const previousChat = await loadChatByClientId(supabase, userData.user.id, id)
    previousMessages = previousChat?.messages.map(msg => {
      if (msg.role === 'assistant') {
        const parsedContent = JSON.parse(msg.content)
        console.log(msg.content)
        if (getType(parsedContent) === 'Array') {
          return {
            id: msg.id,
            role: msg.role,
            content: parsedContent?.[0].text
          }
        } else if (getType(parsedContent) === 'Object') {
          return {
            id: msg.id,
            role: msg.role,
            content: parsedContent
          }
        }
      }
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content
      }
    })
    console.log('previousMessages: ', previousMessages)
  } catch(err) {
    console.log(err)
  }

  if (wantsAnalysis) {
    let chatText = '';
    let imagePath = '';

    /* 5.1 有截图则 OCR，没有则用原文字 */
    if (hasImageAttachment(message)) {
      const img = message.experimental_attachments!.find(a => a.contentType!.startsWith('image/'))!;
      const { path, url } = await uploadWithDedup(img.url);
      const { text } = await generateText({
        model: openai('gpt-4o'),
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
              image: url
            }]
          }
        ]
      });

      imagePath = path
      chatText = text.trim()
    } else {
      chatText = typeof message.content === 'string'
        ? message.content.trim().replace(/^#(分析|analyze)\s*/i, '') // 去掉指令前缀
        : (message.content as any)[0]?.text ?? '';
    }

    const currentUserImageMessage = {
      role: 'user' as 'user' | 'assistant' | 'system' | 'data',
      content: {
        type: 'image',
        text: imagePath
      }
    }
    const pureText =
    typeof message.content === 'string'
      ? message.content
      : (message.content as any)[0]?.text ?? '';
    
    const currentUserMessage = {
      role: 'user' as 'user' | 'assistant' | 'system' | 'data',
      content: pureText as string
    }

    const currentMessages = [currentUserImageMessage, currentUserMessage]

    console.log('image with msg: ', pureText)

    const stream = streamObject({
      model: openai('gpt-4o'),
      schema: Reply,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: ANALYSIS_PROMPT
        },
        ...fewShots,
        {
          role: 'user',
          content: `以下はチャットの文字起こしです：\n${chatText}\n\n相手の行動を分析し、励ましとアドバイスをください。`
        }
      ],
      async onFinish(res) {
        // console.log(res.object)
        const msgs = [
          ...currentMessages,
          {
            role: 'assistant' as 'user' | 'assistant' | 'system' | 'data',
            content: JSON.stringify(res.object)
          }
        ]
        if (userData.user?.id) {
          // console.log('chat finished.', userData.user?.id, id, msgs)
          try {
            await saveChat(supabase, userData.user?.id, id, msgs)
          } catch(err) {
            console.log(err)
          }
        }
      }
    });

    return stream.toTextStreamResponse();
  }

  /* ---------- 6. 普通感情聊天分支 ---------- */
  const pureText =
  typeof message.content === 'string'
    ? message.content
    : (message.content as any)[0]?.text ?? '';
  
  const currentUserMessage = {
    role: 'user' as 'user' | 'assistant' | 'system' | 'data',
    content: pureText as string
  }

  const stream = streamText({
    model: openai('gpt-4o-mini'),
    temperature: 0.8,
    messages: [
      { role: 'system', content: CHAT_PROMPT },
      ...(previousMessages ?? []),
      { role: 'user', content: pureText }
    ],
    async onFinish(res) {
      console.log(res.response.messages[0]?.content)
      const msgs = [
        currentUserMessage,
        ...res.response.messages.map(msg => ({
          role: msg.role,
          content: JSON.stringify(msg.content)
        }))
      ]
      if (userData.user?.id) {
        // console.log('chat finished.', userData.user?.id, id, msgs)
        try {
          await saveChat(supabase, userData.user?.id, id, msgs)
        } catch(err) {
          console.log(err)
        }
      }
    }
  });

  return stream.toTextStreamResponse();
}
