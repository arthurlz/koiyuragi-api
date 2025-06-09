-- ---------- 0. 依赖扩展 ----------
create extension if not exists "uuid-ossp";
create extension if not exists "vector";          -- pgvector，若以后不用可省

-- ---------- 1. 用户表 ----------
-- Supabase 已自带 auth.users，这里无需重复建

-- ---------- 2. 订阅表 ----------
create table public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  platform    text not null check (platform in ('ios','android','stripe')),
  status      text not null check (status in ('active','grace','expired','refunded')),
  expire_at   timestamptz,
  raw_payload jsonb,
  created_at  timestamptz default now()
);
create index on public.subscriptions(user_id);

-- ---------- 3. 会话表 ----------
create table public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  title       text default '',
  started_at  timestamptz default now(),
  latest_at   timestamptz,
  deleted_at  timestamptz,
  is_deleted  boolean default false
);
create index on public.chats(user_id);

-- ---------- 4. 消息表 ----------
create table public.messages (
  id          bigserial primary key,
  chat_id     uuid references public.chats(id) on delete cascade,
  role        text not null check (role in ('user','assistant', 'system', 'data')),
  content     jsonb not null,              -- 用户文本或 AI 三段式
  tokens      int default 0,
  is_deleted  boolean default false,
  deleted_at  timestamptz,
  created_at  timestamptz default now(),
  embedding   vector(1536)                 -- 可选；不用向量时可删
);
create index on public.messages(chat_id, created_at);
create index on public.messages using ivfflat(embedding) with (lists = 100);

-- ---------- 5. 文件表（截图 + OCR 文本） ----------
create table public.files (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid references public.chats(id) on delete cascade,
  storage_key text unique,                 -- Supabase Storage 路径
  ocr_text    text,
  created_at  timestamptz default now()
);

-- ---------- 6. 情绪日记 ----------
create table public.moods (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  score       int not null check (score between 1 and 5),  -- 1最糟~5最好
  note        text,
  created_at  timestamptz default now()
);
create index on public.moods(user_id, created_at);

-- ---------- 7. 情绪日统计物化视图 ----------
create materialized view public.mood_stats as
select
  user_id,
  date_trunc('day', created_at) as day,
  avg(score)::numeric(4,2)      as avg_score,
  count(*)                      as samples
from public.moods
group by 1,2;

create unique index on public.mood_stats(user_id, day);

-- ---------- 8. Row-Level Security ----------
alter table public.chats         enable row level security;
alter table public.messages       enable row level security;
alter table public.files          enable row level security;
alter table public.moods          enable row level security;
alter table public.subscriptions  enable row level security;

/* 用户只能访问自己的行 */
create policy "user can read own chats"
  on public.chats
  for select
  using ( auth.uid() = user_id );

create policy "user can read/update own messages"
  on public.messages
  for all
  using ( auth.uid() = (select user_id from public.chats where id = chat_id) )
  with check ( auth.uid() = (select user_id from public.chats where id = chat_id) );

create policy "user can read own files"
  on public.files
  for select
  using ( auth.uid() = (select user_id from public.chats where id = chat_id) );

create policy "user can read/write own moods"
  on public.moods
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

create policy "user can read own subscriptions"
  on public.subscriptions
  for select
  using ( auth.uid() = user_id );
