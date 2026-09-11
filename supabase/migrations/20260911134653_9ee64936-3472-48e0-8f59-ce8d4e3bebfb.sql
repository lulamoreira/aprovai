
CREATE POLICY "internos leem artes" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'peca-imagens' AND public.is_interno());
CREATE POLICY "internos enviam artes" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'peca-imagens' AND public.is_interno());
CREATE POLICY "internos atualizam artes" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'peca-imagens' AND public.is_interno());
CREATE POLICY "admin apaga artes" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'peca-imagens' AND public.has_role(auth.uid(),'admin'));
