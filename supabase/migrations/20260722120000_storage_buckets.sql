insert into storage.buckets (id, name, public)
values
  ('audio-episodes', 'audio-episodes', false),
  ('audio-raw', 'audio-raw', false),
  ('images', 'images', true),
  ('consent-documents', 'consent-documents', false);

-- images: public can read; admin has full read/write/delete access.
create policy images_select_public
  on storage.objects for select
  using (bucket_id = 'images');

create policy images_admin_all
  on storage.objects for all
  using (bucket_id = 'images' and is_admin())
  with check (bucket_id = 'images' and is_admin());

-- audio-episodes: no public read at all — playback is only ever via a
-- signed URL minted server-side by the get-episode-audio Edge Function
-- (using the service role, which bypasses RLS entirely).
create policy audio_episodes_admin_all
  on storage.objects for all
  using (bucket_id = 'audio-episodes' and is_admin())
  with check (bucket_id = 'audio-episodes' and is_admin());

-- audio-raw: raw elder recordings archive, admin only, never public.
create policy audio_raw_admin_all
  on storage.objects for all
  using (bucket_id = 'audio-raw' and is_admin())
  with check (bucket_id = 'audio-raw' and is_admin());

-- consent-documents: scanned signed agreements, admin only, never public.
create policy consent_documents_admin_all
  on storage.objects for all
  using (bucket_id = 'consent-documents' and is_admin())
  with check (bucket_id = 'consent-documents' and is_admin());
