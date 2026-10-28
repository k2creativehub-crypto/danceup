-- 005_ping.sql
-- Безопасная функция для регулярного «пинга»: обращается к базе и возвращает только true/false.
-- Данные не раскрывает. Вызывается из GitHub Actions по расписанию.
create or replace function public.ping()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers);
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
