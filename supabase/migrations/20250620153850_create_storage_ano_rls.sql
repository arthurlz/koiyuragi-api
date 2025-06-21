CREATE POLICY "Allow anon read from documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  );

-- 2. 允许匿名用户在 documents 桶里上传（INSERT）
CREATE POLICY "Allow anon insert into documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  );

-- 3. 允许匿名用户在 documents 桶里修改（UPDATE）
CREATE POLICY "Allow anon update documents"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  );

-- 4. 允许匿名用户在 documents 桶里删除（DELETE）
CREATE POLICY "Allow anon delete from documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'anon'
  );
