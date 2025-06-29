alter table public.chats
  add column client_id text unique;          -- 保证每个 nanoid 只对应一条会话
create index on public.chats(client_id);
