-- 002_functions.sql
-- Вспомогательные функции для RLS, триггеры, сохранение посещаемости, расчёт счетов.
-- Запускать после 001. Можно запускать повторно.

-- ===============================================================
-- Роли и доступ
-- security definer: функции читают profiles/groups в обход RLS,
-- иначе политики зацикливаются. Права на вызов выдаются ниже.
-- ===============================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.my_teacher_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.teacher_id from public.profiles p
  where p.user_id = auth.uid() and p.role = 'teacher'
  limit 1;
$$;

create or replace function public.is_my_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group and g.teacher_id = public.my_teacher_id()
  );
$$;

-- Ученик состоит в одной из групп текущего учителя
create or replace function public.can_see_student(p_student uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.enrollments e
    join public.groups g on g.id = e.group_id
    where e.student_id = p_student and g.teacher_id = public.my_teacher_id()
  );
$$;

-- Родитель ребёнка из группы текущего учителя
create or replace function public.can_see_guardian(p_guardian uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.students s
    join public.enrollments e on e.student_id = s.id
    join public.groups g on g.id = e.group_id
    where s.guardian_id = p_guardian and g.teacher_id = public.my_teacher_id()
  );
$$;

-- Сегодняшняя дата по Минску (сервер Supabase работает в UTC)
create or replace function public.today_minsk()
returns date
language sql stable as $$
  select (now() at time zone 'Europe/Minsk')::date;
$$;

-- Админ: всегда. Учитель: своя группа и дата от (сегодня - 3 дня) до сегодня.
create or replace function public.can_edit_lesson_date(p_group uuid, p_date date)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_my_group(p_group)
          and p_date between public.today_minsk() - 3 and public.today_minsk());
$$;

create or replace function public.can_view_lesson(p_lesson uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lessons l
    where l.id = p_lesson and (public.is_admin() or public.is_my_group(l.group_id))
  );
$$;

create or replace function public.can_edit_lesson(p_lesson uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lessons l
    where l.id = p_lesson and public.can_edit_lesson_date(l.group_id, l.lesson_date)
  );
$$;

-- Входит ли ученик в группу на дату:
--   active  -> да (с start_date, до end_date, если задана)
--   left    -> только если задана end_date и дата не позже её
--   reserve -> нет
create or replace function public.enrolled_on(p_student uuid, p_group uuid, p_date date)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e
    where e.student_id = p_student
      and e.group_id = p_group
      and (e.start_date is null or e.start_date <= p_date)
      and (
        (e.status = 'active' and (e.end_date is null or e.end_date >= p_date))
        or (e.status = 'left' and e.end_date is not null and e.end_date >= p_date)
      )
  );
$$;

-- Цена занятия группы на дату (null, если цена не задана)
create or replace function public.price_on(p_group uuid, p_date date)
returns integer
language sql stable as $$
  select gp.price_kopecks
  from public.group_prices gp
  where gp.group_id = p_group and gp.valid_from <= p_date
  order by gp.valid_from desc
  limit 1;
$$;

-- ===============================================================
-- Права на вызов: только вошедшие пользователи
-- ===============================================================
revoke all on function public.is_admin() from public, anon;
revoke all on function public.my_teacher_id() from public, anon;
revoke all on function public.is_my_group(uuid) from public, anon;
revoke all on function public.can_see_student(uuid) from public, anon;
revoke all on function public.can_see_guardian(uuid) from public, anon;
revoke all on function public.today_minsk() from public, anon;
revoke all on function public.can_edit_lesson_date(uuid, date) from public, anon;
revoke all on function public.can_view_lesson(uuid) from public, anon;
revoke all on function public.can_edit_lesson(uuid) from public, anon;
revoke all on function public.enrolled_on(uuid, uuid, date) from public, anon;
revoke all on function public.price_on(uuid, date) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_teacher_id() to authenticated;
grant execute on function public.is_my_group(uuid) to authenticated;
grant execute on function public.can_see_student(uuid) to authenticated;
grant execute on function public.can_see_guardian(uuid) to authenticated;
grant execute on function public.today_minsk() to authenticated;
grant execute on function public.can_edit_lesson_date(uuid, date) to authenticated;
grant execute on function public.can_view_lesson(uuid) to authenticated;
grant execute on function public.can_edit_lesson(uuid) to authenticated;
grant execute on function public.enrolled_on(uuid, uuid, date) to authenticated;
grant execute on function public.price_on(uuid, date) to authenticated;

-- ===============================================================
-- Триггер посещаемости:
--  * кто и когда отметил проставляет сервер, а не клиент
--  * нельзя перенести отметку на другое занятие/ученика
--  * ученик должен состоять в группе на дату занятия
-- ===============================================================
create or replace function public.attendance_before_write()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_group uuid;
  v_date  date;
begin
  if tg_op = 'UPDATE' then
    if new.lesson_id <> old.lesson_id or new.student_id <> old.student_id then
      raise exception 'Нельзя менять занятие или ученика у существующей отметки';
    end if;
    if new.mark = old.mark then
      -- ничего не изменилось: сохраняем исходного автора и время
      new.marked_by := old.marked_by;
      new.marked_at := old.marked_at;
      return new;
    end if;
  end if;

  select l.group_id, l.lesson_date into v_group, v_date
  from public.lessons l where l.id = new.lesson_id;

  if v_group is null then
    raise exception 'Занятие не найдено или недоступно';
  end if;

  if not public.enrolled_on(new.student_id, v_group, v_date) then
    raise exception 'Ученик не состоит в группе на дату занятия (%)', v_date;
  end if;

  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$$;

drop trigger if exists attendance_before_write on public.attendance;
create trigger attendance_before_write
  before insert or update on public.attendance
  for each row execute function public.attendance_before_write();

-- ===============================================================
-- Сохранение посещаемости одним вызовом (занятие + отметки, атомарно).
-- security invoker: все проверки делает RLS от имени вызывающего.
-- p_marks: [{"student_id": "<uuid>", "mark": "present|absent|sick|trial"}, ...]
-- ===============================================================
create or replace function public.save_attendance(p_group_id uuid, p_date date, p_marks jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_lesson uuid;
  m jsonb;
begin
  insert into public.lessons (group_id, lesson_date)
  values (p_group_id, p_date)
  on conflict (group_id, lesson_date) do update set group_id = excluded.group_id
  returning id into v_lesson;

  for m in select * from jsonb_array_elements(p_marks) loop
    insert into public.attendance (lesson_id, student_id, mark)
    values (v_lesson, (m->>'student_id')::uuid, m->>'mark')
    on conflict (lesson_id, student_id) do update set mark = excluded.mark;
  end loop;

  return v_lesson;
end;
$$;

revoke all on function public.save_attendance(uuid, date, jsonb) from public, anon;
grant execute on function public.save_attendance(uuid, date, jsonb) to authenticated;

-- ===============================================================
-- Счета (только админ). Ничего не хранится, считается на лету.
-- ===============================================================

-- Строки счёта за период: по ученику и группе.
-- p_group_id = null -> все группы (массовое формирование: передать id группы).
create or replace function public.invoice_lines(p_from date, p_to date, p_group_id uuid default null)
returns table (
  student_id            uuid,
  student_name          text,
  birth_date            date,
  age_years             integer,
  guardian_name         text,
  group_id              uuid,
  group_name            text,
  teacher_name          text,
  lessons_count         integer,
  lessons_without_price integer,
  amount_kopecks        bigint
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Доступ запрещён' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.full_name,
    s.birth_date,
    case when s.birth_date is null then null
         else date_part('year', age(p_to, s.birth_date))::integer end,
    gu.full_name,
    g.id,
    g.name,
    t.full_name,
    (count(a.id) filter (where a.mark = 'present'))::integer,
    (count(a.id) filter (where a.mark = 'present'
                         and public.price_on(g.id, l.lesson_date) is null))::integer,
    coalesce(sum(public.price_on(g.id, l.lesson_date)) filter (where a.mark = 'present'), 0)::bigint
  from public.enrollments e
  join public.students s   on s.id = e.student_id
  join public.groups g     on g.id = e.group_id
  join public.teachers t   on t.id = g.teacher_id
  left join public.guardians gu on gu.id = s.guardian_id
  left join public.lessons l    on l.group_id = g.id and l.lesson_date between p_from and p_to
  left join public.attendance a on a.lesson_id = l.id and a.student_id = s.id
  where e.status <> 'reserve'
    and (p_group_id is null or g.id = p_group_id)
  group by s.id, s.full_name, s.birth_date, gu.full_name, g.id, g.name, t.full_name
  order by g.name, s.full_name;
end;
$$;

-- Баланс на дату нарастающим итогом: начислено - оплачено.
-- debt_kopecks > 0 долг, < 0 переплата.
create or replace function public.student_balances(p_to date)
returns table (
  student_id       uuid,
  charged_kopecks  bigint,
  paid_kopecks     bigint,
  debt_kopecks     bigint
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Доступ запрещён' using errcode = '42501';
  end if;

  return query
  with charged as (
    select a.student_id as sid,
           coalesce(sum(public.price_on(l.group_id, l.lesson_date)), 0)::bigint as amt
    from public.attendance a
    join public.lessons l on l.id = a.lesson_id
    where a.mark = 'present' and l.lesson_date <= p_to
    group by a.student_id
  ),
  paid as (
    select p.student_id as sid, sum(p.amount_kopecks)::bigint as amt
    from public.payments p
    where p.paid_on <= p_to
    group by p.student_id
  )
  select s.id,
         coalesce(c.amt, 0),
         coalesce(pd.amt, 0),
         coalesce(c.amt, 0) - coalesce(pd.amt, 0)
  from public.students s
  left join charged c on c.sid = s.id
  left join paid pd   on pd.sid = s.id;
end;
$$;

revoke all on function public.invoice_lines(date, date, uuid) from public, anon;
revoke all on function public.student_balances(date) from public, anon;
grant execute on function public.invoice_lines(date, date, uuid) to authenticated;
grant execute on function public.student_balances(date) to authenticated;

-- ===============================================================
-- Привязка учётной записи к преподавателю из интерфейса (только админ).
-- Учётную запись (e-mail + пароль) создаёт админ в Supabase -> Authentication.
-- Функция находит пользователя по e-mail и создаёт/обновляет profiles.
-- service_role в браузере не нужен.
-- ===============================================================
create or replace function public.admin_link_account(p_email text, p_role text, p_teacher_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid;
begin
  if not public.is_admin() then
    raise exception 'Доступ запрещён' using errcode = '42501';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email);
  if v_uid is null then
    raise exception 'Учётная запись с e-mail % не найдена. Сначала создайте её в Authentication.', p_email;
  end if;

  insert into public.profiles (user_id, role, teacher_id)
  values (v_uid, p_role, p_teacher_id)
  on conflict (user_id) do update
    set role = excluded.role, teacher_id = excluded.teacher_id;
end;
$$;

revoke all on function public.admin_link_account(text, text, uuid) from public, anon;
grant execute on function public.admin_link_account(text, text, uuid) to authenticated;
