/**
 * 根据前端 nanoid (clientId) 读取会话
 *
 * @param db        已注入用户身份的 Supabase client
 * @param userId    当前登录用户的 uid
 * @param clientId  前端 nanoid
 * @param opts      分页选项
 * @returns         { chatId, title, messages[] } 或 null
 */
export async function loadChatByClientId(
  db: any,
  userId: string,
  clientId: string,
  opts: { limit?: number; beforeId?: number } = {}
): Promise<{
  chatId: string;
  title: string;
  messages: Array<{
    id: number,
    role: 'user' | 'assistant' | 'system' | 'data',
    content: string,
    created_at: string
  }>;
} | null> {
  const { limit = 50, beforeId } = opts;

  /* 1. 找 chat 行 */
  const { data: chat, error: selErr } = await db
    .from('chats')
    .select('id, title, deleted_at')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (selErr) throw selErr;
  if (!chat || chat.deleted_at) return null;        // 会话不存在或已软删

  /* 2. 取消息，按 id 升序（或 created_at）分页 */
  let query = db
    .from('messages')
    .select('id, role, content, created_at')
    .eq('chat_id', chat.id)
    .eq('is_deleted', false)
    .order('id', { ascending: true })
    .limit(limit);

  if (beforeId) {
    query = query.lt('id', beforeId);               // 游标分页
  }

  const { data: messages, error: msgErr } = await query;
  if (msgErr) throw msgErr;

  return { chatId: chat.id, title: chat.title, messages };
}
