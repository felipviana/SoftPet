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
  return used <= 10;
end;
$$;

revoke all on function public.consume_community_submission_slot(text) from public, anon, authenticated;
grant execute on function public.consume_community_submission_slot(text) to service_role;
