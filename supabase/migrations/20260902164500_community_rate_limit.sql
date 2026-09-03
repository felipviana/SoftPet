create table if not exists public.community_submission_limits (
  fingerprint text not null,
  window_date date not null default current_date,
  submissions integer not null default 0,
  primary key (fingerprint, window_date)
);

alter table public.community_submission_limits enable row level security;

create or replace function public.consume_community_submission_slot(request_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  insert into community_submission_limits (fingerprint, window_date, submissions)
  values (request_fingerprint, current_date, 1)
  on conflict (fingerprint, window_date)
  do update set submissions = community_submission_limits.submissions + 1
  returning submissions into used;
  return used <= 3;
end;
$$;

revoke all on function public.consume_community_submission_slot(text) from public, anon, authenticated;
grant execute on function public.consume_community_submission_slot(text) to service_role;

