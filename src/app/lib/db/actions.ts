"use server";

import { and, eq, gt } from "drizzle-orm";
import { db } from "@/app/lib/db";
import { chats, messages } from "@/app/lib/db/schema";
import { UIMessage } from "ai";

export const createChat = async () => {
  const [result] = await db.insert(chats).values({}).returning();
  return result.id;
};

export const upsertMessage = async ({
  chatId,
  message,
  id,
}: {
  id: string;
  chatId: string;
  message: UIMessage;
}) => {
  const [result] = await db
    .insert(messages)
    .values({
      chatId,
      parts: message.parts ?? [],
      role: message.role,
      id,
    })
    .onConflictDoUpdate({
      target: messages.id,
      set: {
        parts: message.parts ?? [],
        chatId,
      },
    })
    .returning();
  return result;
};

export const loadChat = async (chatId: string) => {
  const messagesResult = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.createdAt);
  return messagesResult;
};

export const getChats = async () => {
  const c = await db.select().from(chats);
  return c;
};

export const deleteChat = async (chatId: string) => {
  await db.delete(chats).where(eq(chats.id, chatId));
};

export const deleteMessage = async (messageId: string) => {
  return await db.transaction(async (tx) => {
    const message = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (message.length > 0) {
      const targetMessage = message[0];

      const removed = await tx
        .delete(messages)
        .where(
          and(
            eq(messages.chatId, targetMessage.chatId),
            gt(messages.createdAt, targetMessage.createdAt),
          ),
        ).returning();

      await tx.delete(messages).where(eq(messages.id, messageId));

      return removed;
    }
    return false;
  });
};
