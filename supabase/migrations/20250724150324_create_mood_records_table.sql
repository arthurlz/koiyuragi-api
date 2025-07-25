-- ---------- 6. 心情记录表 ----------
create table public.mood_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  date        date not null,                    -- 记录日期 (YYYY-MM-DD)
  score       int not null check (score >= 1 and score <= 5), -- 心情评分 1-5
  note        text,                             -- 心情备注
  tags        text[],                           -- 标签数组 ['工作', '恋爱', '健康']
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  
  -- 确保每个用户每天只能有一条记录
  unique(user_id, date)
);

create index on public.mood_records(user_id, date desc);
create index on public.mood_records(user_id, created_at desc);

-- 自动更新 updated_at 触发器函数（如果不存在）
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 创建触发器
create trigger update_mood_records_updated_at
  before update on public.mood_records
  for each row
  execute function update_updated_at_column();

-- ---------- 7. 心情统计视图（移除RLS策略）----------
create or replace view public.mood_stats as
select 
  m.user_id,
  count(*) as total_records,
  avg(m.score)::numeric(3,2) as overall_avg,
  -- 最近7天统计
  avg(case when m.date >= current_date - interval '6 days' then m.score end)::numeric(3,2) as avg_7days,
  count(case when m.date >= current_date - interval '6 days' then 1 end) as count_7days,
  -- 最近30天统计  
  avg(case when m.date >= current_date - interval '29 days' then m.score end)::numeric(3,2) as avg_30days,
  count(case when m.date >= current_date - interval '29 days' then 1 end) as count_30days,
  -- 趋势分析 (最近3天 vs 之前3天)
  avg(case when m.date >= current_date - interval '2 days' then m.score end) as recent_3days_avg,
  avg(case when m.date >= current_date - interval '5 days' and m.date < current_date - interval '2 days' then m.score end) as previous_3days_avg,
  -- 最高和最低分
  max(m.score) as max_score,
  min(m.score) as min_score,
  -- 最新记录
  max(m.date) as latest_record_date
from public.mood_records m
group by m.user_id;

-- ---------- RLS 策略（只对表应用）----------
alter table public.mood_records enable row level security;

create policy "user can manage own mood records"
  on public.mood_records
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

-- 注意：视图不需要RLS策略，因为它会继承基础表的安全策略

-- ---------- API 函数 ----------

-- 获取用户心情记录 (带分页)
create or replace function get_mood_records(
  user_uuid uuid,
  limit_count int default 30,
  offset_count int default 0
)
returns table (
  id uuid,
  date date,
  score int,
  note text,
  tags text[],
  created_at timestamptz,
  updated_at timestamptz
) 
language plpgsql
security definer
as $$
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;
  
  return query
  select 
    m.id,
    m.date,
    m.score,
    m.note,
    m.tags,
    m.created_at,
    m.updated_at
  from public.mood_records m
  where m.user_id = user_uuid
  order by m.date desc
  limit limit_count
  offset offset_count;
end;
$$;

-- 获取用户心情统计（直接查询视图，不需要RLS）
create or replace function get_mood_statistics(user_uuid uuid)
returns table (
  total_records bigint,
  overall_avg numeric,
  avg_7days numeric,
  count_7days bigint,
  avg_30days numeric,
  count_30days bigint,
  trend text, -- 'improving', 'stable', 'declining'
  max_score int,
  min_score int,
  latest_record_date date
)
language plpgsql
security definer
as $$
declare
  recent_avg numeric;
  previous_avg numeric;
  trend_result text;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;

  -- 从视图获取统计数据
  select 
    ms.total_records,
    ms.overall_avg,
    ms.avg_7days,
    ms.count_7days,
    ms.avg_30days,
    ms.count_30days,
    ms.recent_3days_avg,
    ms.previous_3days_avg,
    ms.max_score,
    ms.min_score,
    ms.latest_record_date
  into 
    total_records,
    overall_avg,
    avg_7days,
    count_7days,
    avg_30days,
    count_30days,
    recent_avg,
    previous_avg,
    max_score,
    min_score,
    latest_record_date
  from public.mood_stats ms
  where ms.user_id = user_uuid;

  -- 计算趋势
  if recent_avg is null or previous_avg is null then
    trend_result := 'stable';
  elsif recent_avg > previous_avg + 0.3 then
    trend_result := 'improving';
  elsif recent_avg < previous_avg - 0.3 then
    trend_result := 'declining';
  else
    trend_result := 'stable';
  end if;

  trend := trend_result;
  
  -- 如果没有记录，返回默认值
  if total_records is null then
    total_records := 0;
    overall_avg := 0;
    avg_7days := 0;
    count_7days := 0;
    avg_30days := 0;
    count_30days := 0;
    trend := 'stable';
    max_score := 0;
    min_score := 0;
    latest_record_date := null;
  end if;
  
  return next;
end;
$$;

-- 保存/更新心情记录
create or replace function save_mood_record(
  user_uuid uuid,
  record_date date,
  mood_score int,
  mood_note text default null,
  mood_tags text[] default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  record_id uuid;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;
  
  -- 验证评分范围
  if mood_score < 1 or mood_score > 5 then
    raise exception 'Score must be between 1 and 5';
  end if;

  -- 使用 INSERT ... ON CONFLICT 来处理插入或更新
  insert into public.mood_records (user_id, date, score, note, tags)
  values (user_uuid, record_date, mood_score, mood_note, mood_tags)
  on conflict (user_id, date)
  do update set
    score = excluded.score,
    note = excluded.note,
    tags = excluded.tags,
    updated_at = now()
  returning id into record_id;
  
  return record_id;
end;
$$;

-- 删除心情记录
create or replace function delete_mood_record(
  user_uuid uuid,
  record_date date
)
returns boolean
language plpgsql
security definer
as $$
declare
  deleted_count int;
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;
  
  delete from public.mood_records 
  where user_id = user_uuid and date = record_date;
  
  get diagnostics deleted_count = row_count;
  
  return deleted_count > 0;
end;
$$;

-- 获取图表数据 (最近N天)
create or replace function get_mood_chart_data(
  user_uuid uuid,
  days_count int default 7
)
returns table (
  date date,
  score int,
  day_offset int
)
language plpgsql
security definer
as $$
begin
  -- 验证用户权限
  if auth.uid() != user_uuid then
    raise exception 'Access denied';
  end if;
  
  return query
  with date_series as (
    select 
      (current_date - interval '1 day' * (days_count - 1 - generate_series))::date as chart_date,
      generate_series as day_offset
    from generate_series(0, days_count - 1)
  )
  select 
    ds.chart_date,
    coalesce(m.score, 0) as score,
    ds.day_offset
  from date_series ds
  left join public.mood_records m on m.date = ds.chart_date and m.user_id = user_uuid
  order by ds.chart_date;
end;
$$;
