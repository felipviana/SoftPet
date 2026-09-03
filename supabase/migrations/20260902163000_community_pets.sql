create extension if not exists pgcrypto;

create table if not exists public.community_pets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  author_name text not null default 'Anônimo' check (char_length(author_name) between 1 and 60),
  manifest_path text not null,
  sheet_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  downloads bigint not null default 0 check (downloads >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.community_pets enable row level security;

create policy "Qualquer pessoa pode listar pets aprovados"
on public.community_pets for select
to anon, authenticated
using (status = 'approved');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-pets',
  'community-pets',
  true,
  8388608,
  array['application/json', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- O cliente nunca escreve diretamente no bucket ou na tabela. Somente a Edge
-- Function, usando a service role mantida pelo Supabase, recebe os envios.
create policy "Leitura publica dos arquivos da comunidade"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'community-pets');

