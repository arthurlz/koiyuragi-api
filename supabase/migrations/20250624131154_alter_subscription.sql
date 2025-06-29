-- 1-A. 扩充 status 列枚举
alter table public.subscriptions
  drop constraint subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
    check (status in ('active','grace','expired','refunded','trial'));

-- 1-B. 新增试用到期列
alter table public.subscriptions
  add column trial_until timestamptz;

-- 1-C. 给 (user_id, status) 加唯一索引
--    👉 保证同一用户同一状态最多一条，防止重复 trial
create unique index if not exists subscriptions_user_status_uidx
  on public.subscriptions(user_id, status)
  where status = 'trial';
