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

/* 检查消息是否有有效内容 */
const hasValidContent = (message: Message): boolean => {
  // 检查文本内容
  let textContent = '';
  if (typeof message.content === 'string') {
    textContent = message.content.trim();
  } else if (Array.isArray(message.content)) {
    textContent = (message.content as any)
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('')
      .trim();
  }
  
  // 检查附件
  const hasAttachment = hasImageAttachment(message);
  
  // 有文本内容或有附件才算有效
  return textContent.length > 0 || hasAttachment;
};

/* 提取纯文本内容 */
const extractTextContent = (message: Message): string => {
  if (typeof message.content === 'string') {
    return message.content.trim();
  } else if (Array.isArray(message.content)) {
    return message.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('')
      .trim();
  }
  return '';
};

/* 智能判断是否需要深度分析 */
const shouldAnalyze = (message: Message): boolean => {
  const content = extractTextContent(message);
  
  // 1. 有图片附件 - 通常是聊天截图需要分析
  if (hasImageAttachment(message)) {
    return true;
  }
  
  // 2. 明确的分析指令
  if (content.startsWith('#分析') || content.startsWith('#analyze')) {
    return true;
  }
  
  // 3. 内容长度判断 - 长文本可能需要深度分析
  if (content.length > 150) {
    return true;
  }
  
  // 4. 关键词检测 - 用户明确寻求建议
  const adviceKeywords = [
    'どうしたら', 'どうすれば', 'アドバイス', '助けて',
    'つらい', '悩んで', '困って', '不安',
    'どう思う', 'どうしよう', '教えて'
  ];
  
  if (adviceKeywords.some(keyword => content.includes(keyword))) {
    return true;
  }
  
  // 5. 问句检测 - 包含问号通常需要分析
  if (content.match(/[？?]/)) {
    return true;
  }
  
  // 6. 情绪词检测 - 负面情绪可能需要深度支持
  const emotionKeywords = [
    '悲しい', '寂しい', '辛い', '苦しい',
    '怖い', '不安', 'ストレス', '疲れ'
  ];
  
  if (emotionKeywords.some(keyword => content.includes(keyword))) {
    return true;
  }
  
  // 默认使用轻松聊天模式
  return false;
};

/* 创建要保存的消息数组，过滤无效消息 */
const createMessagesToSave = (
  textContent: string, 
  imagePath: string = '', 
  assistantResponse: any
): Array<{ role: 'user' | 'assistant' | 'system' | 'data', content: any }> => {
  const messages: Array<{ role: 'user' | 'assistant' | 'system' | 'data', content: any }> = [];
  
  // 只有当有图片路径时才保存图片消息（用于记录，但不用于对话）
  if (imagePath) {
    messages.push({
      role: 'user',
      content: {
        type: 'image',
        text: imagePath
      }
    });
  }
  
  // 只有当有文本内容时才保存文本消息
  if (textContent.trim()) {
    messages.push({
      role: 'user',
      content: textContent.trim()
    });
  }
  
  // 总是保存AI回复（如果有）
  if (assistantResponse) {
    messages.push({
      role: 'assistant',
      content: assistantResponse
    });
  }
  
  return messages;
};

/* 2) API 入口 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer /, '');
  console.log('token: ', token);
  const supabase = createAuthDb(token ?? '');
  const { data: userData } = await supabase.auth.getUser(token);
  
  const data = await req.json();
  console.log(data);
  const { id, message }: { id: string, message: Message } = data;
  const userMsg = message.role === 'user';
  if (!userMsg) return new Response('no user message', { status: 400 });

  if (!userData.user?.id) {
    return new Response('no user', { status: 401 });
  }

  // 检查消息是否有有效内容
  if (!hasValidContent(message)) {
    console.log('Empty message detected, skipping...');
    return new Response('empty message', { status: 400 });
  }

  // 获取历史消息并过滤格式
  let previousMessages: Array<{
    role: 'user' | 'assistant' | 'system',
    content: string,
  }> = [];
  
  try {
    const previousChat = await loadChatByClientId(supabase, userData.user.id, id);
    if (previousChat?.messages) {
      previousMessages = previousChat.messages
        .filter(msg => {
          // 过滤掉图片消息和空消息
          if (msg.role === 'user') {
            if (typeof msg.content === 'object' && msg.content.type === 'image') {
              return false;
            }
            if (typeof msg.content === 'string' && !msg.content.trim()) {
              return false;
            }
          }
          return true;
        })
        .map(msg => {
          if (msg.role === 'assistant') {
            try {
              const parsedContent = JSON.parse(msg.content);
              if (getType(parsedContent) === 'Array') {
                return {
                  role: msg.role as 'assistant',
                  content: parsedContent?.[0].text || ''
                };
              } else if (getType(parsedContent) === 'Object') {
                // 如果是分析结果，转换为友好的文本
                if (parsedContent.empathy) {
                  return {
                    role: msg.role as 'assistant',
                    content: `${parsedContent.empathy}\n\n${parsedContent.analysis}\n\n${parsedContent.suggestion}`
                  };
                }
                return {
                  role: msg.role as 'assistant',
                  content: JSON.stringify(parsedContent)
                };
              }
            } catch (e) {
              // 如果不是 JSON，直接使用原内容
              return {
                role: msg.role as 'assistant',
                content: msg.content
              };
            }
          }
          
          // 用户消息
          return {
            role: msg.role as 'user',
            content: typeof msg.content === 'string' ? msg.content : ''
          };
        })
        .filter(msg => msg.content.trim()) // 过滤掉空内容
    }
    console.log('filtered previousMessages: ', previousMessages);
  } catch(err) {
    console.log('Error loading previous messages:', err);
  }

  /* ---- 智能判断是否需要三段式分析 ---- */
  const wantsAnalysis = shouldAnalyze(message);
  console.log('Analysis mode:', wantsAnalysis ? 'ANALYSIS' : 'CHAT');

  if (wantsAnalysis) {
    let chatText = '';
    let imagePath = '';
    const textContent = extractTextContent(message);

    /* 有截图则 OCR，没有则用原文字 */
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

      imagePath = path;
      chatText = text.trim();
    } else {
      chatText = textContent.replace(/^#(分析|analyze)\s*/i, '');
    }

    // 确保有内容可分析
    const analysisContent = chatText || textContent;
    if (!analysisContent.trim()) {
      console.log('No content to analyze');
      return new Response('no content to analyze', { status: 400 });
    }

    console.log('Analyzing with text:', analysisContent);

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
          content: hasImageAttachment(message) 
            ? `以下はチャットの文字起こしです：\n${chatText}\n\n相手の行動を分析し、励ましとアドバイスをください。`
            : `ユーザーの悩み：\n${analysisContent}\n\n相手の気持ちに共感し、状況を分析して、具体的なアドバイスをください。`
        }
      ],
      async onFinish(res) {
        // 只保存有效的消息
        const messagesToSave = createMessagesToSave(
          textContent,
          imagePath,
          JSON.stringify(res.object)
        );
        
        // 如果没有有效消息要保存，就不保存
        if (messagesToSave.length === 0) {
          console.log('No valid messages to save');
          return;
        }
        
        if (userData.user?.id) {
          try {
            await saveChat(supabase, userData.user?.id, id, messagesToSave);
            console.log('Saved analysis messages:', messagesToSave.length);
          } catch(err) {
            console.log('Error saving chat:', err);
          }
        }
      }
    });

    return stream.toTextStreamResponse();
  }

  /* ---------- 普通感情聊天分支 ---------- */
  const textContent = extractTextContent(message);
  
  // 再次检查文本内容是否为空
  if (!textContent.trim()) {
    console.log('Empty text message in chat mode');
    return new Response('empty text message', { status: 400 });
  }

  console.log('Chat mode with text:', textContent);

  const stream = streamText({
    model: openai('gpt-4o-mini'),
    temperature: 0.8,
    messages: [
      { role: 'system', content: CHAT_PROMPT },
      ...previousMessages,
      { role: 'user', content: textContent }
    ],
    async onFinish(res) {
      console.log(res.response.messages[0]?.content);
      
      // 只保存有文本内容的消息
      const messagesToSave = createMessagesToSave(
        textContent,
        '', // 聊天模式不保存图片
        JSON.stringify(res.response.messages.map(msg => msg.content))
      );
      
      if (messagesToSave.length === 0) {
        console.log('No valid messages to save in chat mode');
        return;
      }
      
      if (userData.user?.id) {
        try {
          await saveChat(supabase, userData.user?.id, id, messagesToSave);
          console.log('Saved chat messages:', messagesToSave.length);
        } catch(err) {
          console.log('Error saving chat:', err);
        }
      }
    }
  });

  return stream.toTextStreamResponse();
}
