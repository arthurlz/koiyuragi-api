/** `chatId` 为空表示新会话 */
export async function saveChat(
  db: any,
  userId: string,
  clientId: string | null,
  newMsgs: {
    role: 'user' | 'assistant' | 'system' | 'tool' | 'data';
    content: any;      // string | 三段式 JSON
    tokens?: number;
    embedding?: number[]; // 若要存向量
  }[]
) {
  console.log(userId)
  /* 1. 先查是否已有同 clientId 会话 */
  const { data: existing, error: selErr } = await db
    .from('chats')
    .select('id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (selErr) throw selErr;

  let chatUuid: string;

  if (existing) {
    chatUuid = existing.id;

    /* 1-B. 更新 latest_at */
    await db
      .from('chats')
      .update({ latest_at: new Date() })
      .eq('id', chatUuid)
      .eq('user_id', userId);
  } else {
    /* 1-A. 不存在则插入新会话 */
    const { data: created, error: insErr } = await db
      .from('chats')
      .insert({
        client_id: clientId,
        user_id: userId,
        latest_at: new Date()
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    chatUuid = created.id;
  }

  //* 2. 批量写入消息 */
  const rows = newMsgs.map((m) => ({
    chat_id:   chatUuid,
    role:      m.role,
    content:   m.content,
    tokens:    m.tokens ?? 0,
    embedding: m.embedding ?? null
  }));

  const { error: msgErr } = await db.from('messages').insert(rows);
  if (msgErr) throw msgErr;

  return chatUuid;
}
