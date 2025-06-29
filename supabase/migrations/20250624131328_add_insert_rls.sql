create policy "user can create own chats"
  on public.chats
  for insert
  with check ( auth.uid() = user_id );

create policy "user can create own messages"
  on public.messages
  for insert
  with check (
    auth.uid() = (
      select user_id from public.chats where id = chat_id
    )
  );

create policy "user can create own files"
  on public.files
  for insert
  with check (
    auth.uid() = (
      select user_id from public.chats where id = chat_id
    )
  );

create policy "user can update own files"
  on public.files
  for update
  using (
    auth.uid() = (
      select user_id from public.chats where id = chat_id
    )
  )
  with check ( true );       -- 可细分列：with check ( ocr_text is not null )
