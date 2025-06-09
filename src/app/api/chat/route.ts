export const runtime = 'edge';

import { streamObject, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const Reply = z.object({
  empathy: z.string(),
  analysis: z.string(),
  suggestion: z.object({
    strategy: z.enum(['保持距离', '等待时机', '主动沟通']),
    message: z.string()
  })
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const userId = req.headers.get('x-user-id')!;
  console.log(messages);
  const result = streamObject({
    model: openai('gpt-4o'),
    schema: Reply,
    temperature: 0.8,
    messages: [
      { role: 'system', content: '你是治愈系恋爱顾问AI.' },
      ...messages
    ]
  });

  // TODO: 写入 Supabase (异步)
  // supabase.from('messages').insert({ user_id: userId, content: await result.full })

  // return new Response(result.fullStream, {
  //   headers: { 'Content-Type': 'text/event-stream' }
  // });
  // console.log(result.toTextStreamResponse())
  return result.toTextStreamResponse();
}
