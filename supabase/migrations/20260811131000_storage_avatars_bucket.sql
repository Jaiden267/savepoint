-- avatars storage bucket. Public bucket; each user may only write within
-- their own folder, keyed by their auth.uid(). profiles.avatar_path stores
-- exactly this object path (e.g. "<uid>/avatar.webp") — never a signed or
-- public URL (see the comment on profiles.avatar_path).
--
-- No bucket is created for game artwork: IGDB image ids
-- (games.cover_image_id, etc.) stay external references, resolved to IGDB's
-- own CDN client-side. This is the only storage bucket in this schema.
--
-- storage.objects already has Row Level Security enabled by default in every
-- Supabase project — only policies are added here, not
-- `alter table storage.objects enable row level security`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar images are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'avatars');

-- Path convention: object name = "<auth.uid()>/<filename>" — the bucket
-- itself is already "avatars", so the uid is the first path segment inside
-- it. storage.foldername(name) returns the path segments before the
-- filename as an array; [1] is that leading uid segment — the standard
-- Supabase Storage pattern for "each user owns their own folder".
create policy "users can upload their own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can update their own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can delete their own avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
