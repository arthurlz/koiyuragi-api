export const runtime = 'nodejs';

import { createAuthDb } from "@/app/lib/supabase";
import { BUCKET_NAME } from "@/app/lib/supabase/const";
import { loadChatByClientId } from "@/app/lib/supabase/loadChat";
import { getType } from "@/app/lib/utils";
import { NextRequest } from "next/server";


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } } 
) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer /, '');
  console.log(`token: ${token}`)
  const supabase = createAuthDb(token ?? '');

  const { id: clientId } = await params

  /* 3. 如果需要 userId： */
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData.user?.id) return new Response('no user', { status: 401 });

  const chat = await loadChatByClientId(supabase, userData.user?.id, clientId)

  const messages = await Promise.all(chat?.messages
    // .filter(msg => !(msg.type === 'image'))
    .map(async msg => {
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
      } else if (msg.role === 'user' && msg.content.type === 'image') {
        // const { data: publicUrlData } = supabase
        //   .storage
        //   .from(BUCKET_NAME)
        //   .getPublicUrl(msg.content.text)
        // const publicUrl = publicUrlData.publicUrl
        const { data } = await supabase
          .storage
          .from(BUCKET_NAME)
          .createSignedUrl(((msg.content as any).text), 60)
        return {
          id: msg.id,
          role: msg.role,
          content: {
            ...msg.content,
            text: data?.signedUrl,
            // 'https://rybduoooeslhhsfusrue.supabase.co/storage/v1/object/sign/documents/uploads/635ee8fac6962950cef5fdfa2e3c46e4028420f37b6c14b5cda44e5ebaa0217f.webp?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9kNjY0YjYwYi1mYjU0LTRiZDQtOTJkYi01M2JlODM4MzkwNjQiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJkb2N1bWVudHMvdXBsb2Fkcy82MzVlZThmYWM2OTYyOTUwY2VmNWZkZmEyZTNjNDZlNDAyODQyMGYzN2I2YzE0YjVjZGE0NGU1ZWJhYTAyMTdmLndlYnAiLCJpYXQiOjE3NTI2NzE1MjYsImV4cCI6MTc1MzI3NjMyNn0.yxUsfldJD3dxCmL_Vg7beN_MByzYbd_I5TXGBFzjfYk'
          }
          // data?.signedUrl
        }
      }
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content //JSON.parse(msg.content)?.[0].text
      }
    }) ?? [])

  return Response.json(messages);
}
