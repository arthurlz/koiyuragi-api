-- ---------- 扩展订阅表功能 ----------
-- 为订阅表添加更多字段
alter table public.subscriptions add column if not exists product_id text;
alter table public.subscriptions add column if not exists original_transaction_id text;
alter table public.subscriptions add column if not exists purchase_date timestamptz;
alter table public.subscriptions add column if not exists cancellation_date timestamptz;
alter table public.subscriptions add column if not exists grace_period_expires_date timestamptz;

-- 添加索引优化查询性能
create index if not exists idx_subscriptions_user_status on public.subscriptions(user_id, status);
create index if not exists idx_subscriptions_expire_at on public.subscriptions(expire_at);

-- ---------- 使用限制表 ----------
create table public.usage_limits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  date        date not null default current_date,
  ai_messages int default 0,              -- AI对话消息数
  image_uploads int default 0,            -- 图片上传数
  mood_records int default 0,             -- 心情记录数 (premium功能)
  breathing_sessions int default 0,       -- 呼吸练习次数
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  
  unique(user_id, date)
);

create index on public.usage_limits(user_id, date desc);

-- 自动更新 updated_at
create trigger update_usage_limits_updated_at
  before update on public.usage_limits
  for each row
  execute function update_updated_at_column();

-- ---------- 订阅计划配置表 ----------
create table public.subscription_plans (
  id              text primary key,
  name            text not null,
  description     text,
  price_monthly   decimal(10,2),
  price_yearly    decimal(10,2),
  features        jsonb not null default '{}',
  limits          jsonb not null default '{}',
  is_active       boolean default true,
  created_at      timestamptz default now()
);

-- 插入基础订阅计划
insert into public.subscription_plans (id, name, description, price_monthly, price_yearly, features, limits) values
('free', '無料プラン', '基本的な機能を利用できます', 0, 0, 
 '{"ai_chat": true, "mood_tracking": true, "breathing_exercise": true}',
 '{"daily_ai_messages": 1, "daily_image_uploads": 0, "mood_history_days": 7}'),
('premium', 'プレミアムプラン', '全ての機能を無制限で利用できます', 980, 9800,
 '{"unlimited_ai_chat": true, "image_analysis": true, "advanced_mood_tracking": true, "export_data": true, "priority_support": true}',
 '{"daily_ai_messages": -1, "daily_image_uploads": 10, "mood_history_days": -1}');

-- ---------- RLS 策略 ----------
alter table public.usage_limits enable row level security;
alter table public.subscription_plans enable row level security;

create policy "user can manage own usage limits"
  on public.usage_limits for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

create policy "anyone can read subscription plans"
  on public.subscription_plans for select
  using ( true );

-- ---------- 订阅状态检查函数 ----------
create or replace function get_user_subscription_status(user_uuid uuid)
returns table (
  is_premium boolean,
  status text,
  expires_at timestamptz,
  plan_id text,
  days_remaining int
)
language plpgsql
security definer
as $$
declare
  sub_record record;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 查找用户的有效订阅
  select * into sub_record
  from public.subscriptions s
  where s.user_id = user_uuid 
    and s.status in ('active', 'grace')
    and (s.expire_at is null or s.expire_at > now())
  order by s.created_at desc
  limit 1;

  if sub_record.id is not null then
    -- 有有效订阅
    is_premium := true;
    status := sub_record.status;
    expires_at := sub_record.expire_at;
    plan_id := 'premium';
    
    if sub_record.expire_at is not null then
      days_remaining := extract(days from (sub_record.expire_at - now()))::int;
    else
      days_remaining := -1; -- 永久订阅
    end if;
  else
    -- 免费用户
    is_premium := false;
    status := 'free';
    expires_at := null;
    plan_id := 'free';
    days_remaining := 0;
  end if;
  
  return next;
end;
$$;

-- ---------- 使用限制检查函数 ----------
create or replace function check_usage_limit(
  user_uuid uuid,
  limit_type text, -- 'ai_messages', 'image_uploads', 'mood_records'
  increment_count int default 1
)
returns table (
  allowed boolean,
  current_usage int,
  daily_limit int,
  remaining int,
  is_premium boolean
)
language plpgsql
security definer
as $$
declare
  today_usage int := 0;
  user_limit int := 0;
  sub_status record;
  plan_limits jsonb;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 获取用户订阅状态
  select * into sub_status from get_user_subscription_status(user_uuid);
  is_premium := sub_status.is_premium;

  -- 获取计划限制
  select limits into plan_limits 
  from public.subscription_plans 
  where id = sub_status.plan_id;

  -- 根据类型获取每日限制
  case limit_type
    when 'ai_messages' then
      user_limit := (plan_limits->>'daily_ai_messages')::int;
    when 'image_uploads' then  
      user_limit := (plan_limits->>'daily_image_uploads')::int;
    when 'mood_records' then
      user_limit := 1; -- 每天只能记录一次心情
    else
      raise exception 'Invalid limit type: %', limit_type;
  end case;

  -- -1 表示无限制
  if user_limit = -1 then
    allowed := true;
    current_usage := 0;
    daily_limit := -1;
    remaining := -1;
    return next;
    return;
  end if;

  -- 获取今日使用量
  select 
    case limit_type
      when 'ai_messages' then coalesce(ai_messages, 0)
      when 'image_uploads' then coalesce(image_uploads, 0) 
      when 'mood_records' then coalesce(mood_records, 0)
    end
  into today_usage
  from public.usage_limits
  where user_id = user_uuid and date = current_date;

  today_usage := coalesce(today_usage, 0);
  current_usage := today_usage;
  daily_limit := user_limit;

  -- 检查是否超过限制
  if today_usage + increment_count <= user_limit then
    allowed := true;
    remaining := user_limit - today_usage;
  else
    allowed := false;
    remaining := 0;
  end if;

  return next;
end;
$$;

-- ---------- 记录使用量函数 ----------
create or replace function record_usage(
  user_uuid uuid,
  usage_type text,
  count_increment int default 1
)
returns boolean
language plpgsql
security definer
as $$
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 插入或更新使用记录
  insert into public.usage_limits (user_id, date, ai_messages, image_uploads, mood_records, breathing_sessions)
  values (
    user_uuid, 
    current_date,
    case when usage_type = 'ai_messages' then count_increment else 0 end,
    case when usage_type = 'image_uploads' then count_increment else 0 end,
    case when usage_type = 'mood_records' then count_increment else 0 end,
    case when usage_type = 'breathing_sessions' then count_increment else 0 end
  )
  on conflict (user_id, date)
  do update set
    ai_messages = case when usage_type = 'ai_messages' then usage_limits.ai_messages + count_increment else usage_limits.ai_messages end,
    image_uploads = case when usage_type = 'image_uploads' then usage_limits.image_uploads + count_increment else usage_limits.image_uploads end,
    mood_records = case when usage_type = 'mood_records' then usage_limits.mood_records + count_increment else usage_limits.mood_records end,
    breathing_sessions = case when usage_type = 'breathing_sessions' then usage_limits.breathing_sessions + count_increment else usage_limits.breathing_sessions end,
    updated_at = now();

  return true;
end;
$$;

-- ---------- 获取使用统计函数 ----------
create or replace function get_usage_stats(user_uuid uuid)
returns table (
  today_ai_messages int,
  today_image_uploads int,
  today_mood_records int,
  today_breathing_sessions int,
  weekly_ai_messages bigint,
  monthly_ai_messages bigint,
  is_premium boolean,
  limits jsonb
)
language plpgsql
security definer
as $$
declare
  sub_status record;
  plan_limits jsonb;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 获取订阅状态
  select * into sub_status from get_user_subscription_status(user_uuid);
  is_premium := sub_status.is_premium;

  -- 获取计划限制
  select sp.limits into plan_limits 
  from public.subscription_plans sp
  where sp.id = sub_status.plan_id;
  
  limits := plan_limits;

  -- 获取今日使用量
  select 
    coalesce(ul.ai_messages, 0),
    coalesce(ul.image_uploads, 0),
    coalesce(ul.mood_records, 0),
    coalesce(ul.breathing_sessions, 0)
  into 
    today_ai_messages,
    today_image_uploads, 
    today_mood_records,
    today_breathing_sessions
  from public.usage_limits ul
  where ul.user_id = user_uuid and ul.date = current_date;

  -- 获取周使用量
  select coalesce(sum(ul.ai_messages), 0)
  into weekly_ai_messages
  from public.usage_limits ul
  where ul.user_id = user_uuid 
    and ul.date >= current_date - interval '6 days';

  -- 获取月使用量  
  select coalesce(sum(ul.ai_messages), 0)
  into monthly_ai_messages
  from public.usage_limits ul
  where ul.user_id = user_uuid 
    and ul.date >= current_date - interval '29 days';

  -- 设置默认值
  today_ai_messages := coalesce(today_ai_messages, 0);
  today_image_uploads := coalesce(today_image_uploads, 0);
  today_mood_records := coalesce(today_mood_records, 0);
  today_breathing_sessions := coalesce(today_breathing_sessions, 0);
  weekly_ai_messages := coalesce(weekly_ai_messages, 0);
  monthly_ai_messages := coalesce(monthly_ai_messages, 0);

  return next;
end;
$$;

-- ---------- 订阅管理函数 ----------
-- 创建订阅
create or replace function create_subscription(
  user_uuid uuid,
  platform_name text,
  product_id_param text,
  transaction_id text,
  expiry_date timestamptz,
  payload jsonb default '{}'
)
returns uuid
language plpgsql
security definer
as $$
declare
  subscription_id uuid;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 创建新订阅
  insert into public.subscriptions (
    user_id, 
    platform, 
    status, 
    product_id,
    original_transaction_id,
    expire_at,
    purchase_date,
    raw_payload
  ) values (
    user_uuid,
    platform_name,
    'active',
    product_id_param,
    transaction_id,
    expiry_date,
    now(),
    payload
  ) returning id into subscription_id;

  return subscription_id;
end;
$$;

-- 更新订阅状态
create or replace function update_subscription_status(
  user_uuid uuid,
  transaction_id text,
  new_status text,
  new_expiry timestamptz default null
)
returns boolean
language plpgsql
security definer  
as $$
declare
  updated_count int;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 验证状态值
  if new_status not in ('active', 'grace', 'expired', 'refunded') then
    raise exception 'Invalid subscription status: %', new_status;
  end if;

  -- 更新订阅
  update public.subscriptions
  set 
    status = new_status,
    expire_at = coalesce(new_expiry, expire_at),
    cancellation_date = case when new_status in ('expired', 'refunded') then now() else cancellation_date end
  where user_id = user_uuid 
    and original_transaction_id = transaction_id;

  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;
