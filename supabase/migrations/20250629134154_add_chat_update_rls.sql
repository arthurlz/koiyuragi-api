-- 允许用户更新自己拥有的 chat 行
create policy "user can update own chats"
  on public.chats
  for update
  using ( auth.uid() = user_id )     -- 行必须属于当前登录用户
  with check ( auth.uid() = user_id ); -- 更新后仍然属于该用户
