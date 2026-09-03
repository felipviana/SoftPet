create unique index if not exists community_pets_display_name_unique
on public.community_pets (
  lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))
);

create or replace function public.community_pet_name_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.community_pets
    where lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(candidate), '\s+', ' ', 'g'))
  );
$$;

revoke all on function public.community_pet_name_available(text) from public, anon, authenticated;
grant execute on function public.community_pet_name_available(text) to service_role;
