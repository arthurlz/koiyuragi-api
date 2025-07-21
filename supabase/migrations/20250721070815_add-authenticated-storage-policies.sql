/*-----------------------------------------------------------
  documents bucket – authenticated users policies
-----------------------------------------------------------*/

-- 1. read
CREATE POLICY "Allow authenticated read from documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

-- 2. insert
CREATE POLICY "Allow authenticated insert into documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

-- 3. update
CREATE POLICY "Allow authenticated update documents"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

-- 4. delete
CREATE POLICY "Allow authenticated delete from documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );
