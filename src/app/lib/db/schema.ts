import { UIMessage } from "ai";
import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

export const chats = pgTable("chats", {
  id: varchar()
    .primaryKey()
    .$defaultFn(() => nanoid()),
});

export const roleEnum = pgEnum("role", ["user", "assistant", "system", "data"]);

export const messages = pgTable("messages", {
  id: varchar()
    .primaryKey()
    .$defaultFn(() => nanoid()),
  chatId: varchar()
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  // TODO: update type to UIMessagePart in AI SDK v5
  parts: jsonb().$type<UIMessage["parts"]>().notNull(),
  role: roleEnum().notNull(),
});
