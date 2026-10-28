-- 003_rls.sql
-- Политики доступа (RLS), представление для зачислений, права.
-- Запускать после 001 и 002. Можно запускать повторно.
--
-- Правила:
--   admin   : всё.
--   teacher : только свои группы; видит группы, расписание, учеников и родителей
--             своих групп, посещаемость; НЕ видит цены, оплаты, договоры, заметки.
--   anon    : ничего.

-- ===============================================================
-- Включаем RLS на новых таблицах (на старых уже включён)
-- ===============================================================
alter table public.profiles       enable row level security;
alter table public.group_schedule enable row level security;
alter table public.group_prices   enable row level security;
alter table public.lessons        enable row level security;
alter table public.attendance     enable row level security;
alter table public.payments       enable row level security;

-- ===============================================================
-- profiles (политика «own profile» уже есть, её не трогаем)
-- ===============================================================
drop policy if exists admin_all on public.profiles;
create policy admin_all on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===============================================================
-- teachers
-- ===============================================================
drop policy if exists admin_all on public.teachers;
create policy admin_all on public.teachers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists teacher_select_self on public.teachers;
create policy teacher_select_self on public.teachers
  for select to authenticated
  using (id = public.my_teacher_id());

-- ===============================================================
-- groups
-- ===============================================================
drop policy if exists admin_all on public.groups;
create policy admin_all on public.groups
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists teacher_select_own on public.groups;
create policy teacher_select_own on public.groups
  for select to authenticated
  using (teacher_id = public.my_teacher_id());

-- ===============================================================
-- group_schedule (учитель только читает расписание своих групп)
-- ===============================================================
drop policy if exists admin_all on public.group_schedule;
create policy admin_all on public.group_schedule
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists teacher_select_own on public.group_schedule;
create policy teacher_select_own on public.group_schedule
  for select to authenticated
  using (public.is_my_group(group_id));

-- ===============================================================
-- students / guardians (учитель читает только детей своих групп и их родителей)
-- ===============================================================
drop policy if exists admin_all on public.students;
create policy admin_all on public.students
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists teacher_select_own on public.students;
create policy teacher_select_own on public.students
  for select to authenticated
  using (public.can_see_student(id));

drop policy if exists admin_all on public.guardians;
create policy admin_all on public.guardians
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists teacher_select_own on public.guardians;
create policy teacher_select_own on public.guardians
  for select to authenticated
  using (public.can_see_guardian(id));

-- ===============================================================
-- enrollments: таблица только для админа.
-- Учитель (и приложение вообще) читает через представление enrollments_v,
-- где договор, заметки и источник скрыты для не-админа.
-- ===============================================================
drop policy if exists admin_all on public.enrollments;
create policy admin_all on public.enrollments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace view public.enrollments_v as
select
  e.id,
  e.student_id,
  e.group_id,
  e.season,
  e.is_primary,
  e.status,
  e.start_date,
  e.end_date,
  e.trial_date,
  e.trial_note,
  case when public.is_admin() then e.contract_number end as contract_number,
  case when public.is_admin() then e.contract_date   end as contract_date,
  case when public.is_admin() then e.notes           end as notes,
  case when public.is_admin() then e.source_ref      end as source_ref
from public.enrollments e
where public.is_admin() or public.is_my_group(e.group_id);

-- ===============================================================
-- group_prices, payments: только админ
-- ===============================================================
drop policy if exists admin_all on public.group_prices;
create policy admin_all on public.group_prices
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all on public.payments;
create policy admin_all on public.payments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===============================================================
-- lessons
--   читать: админ, учитель своей группы (вся история)
--   создавать/менять: админ всегда; учитель - сегодня и 3 предыдущих дня (Минск)
--   удалять: только админ
-- ===============================================================
drop policy if exists select_lessons on public.lessons;
create policy select_lessons on public.lessons
  for select to authenticated
  using (public.is_admin() or public.is_my_group(group_id));

drop policy if exists insert_lessons on public.lessons;
create policy insert_lessons on public.lessons
  for insert to authenticated
  with check (public.can_edit_lesson_date(group_id, lesson_date));

drop policy if exists update_lessons on public.lessons;
create policy update_lessons on public.lessons
  for update to authenticated
  using (public.can_edit_lesson_date(group_id, lesson_date))
  with check (public.can_edit_lesson_date(group_id, lesson_date));

drop policy if exists delete_lessons on public.lessons;
create policy delete_lessons on public.lessons
  for delete to authenticated
  using (public.is_admin());

-- ===============================================================
-- attendance (права определяются занятием, к которому относится отметка)
-- ===============================================================
drop policy if exists select_attendance on public.attendance;
create policy select_attendance on public.attendance
  for select to authenticated
  using (public.can_view_lesson(lesson_id));

drop policy if exists insert_attendance on public.attendance;
create policy insert_attendance on public.attendance
  for insert to authenticated
  with check (public.can_edit_lesson(lesson_id));

drop policy if exists update_attendance on public.attendance;
create policy update_attendance on public.attendance
  for update to authenticated
  using (public.can_edit_lesson(lesson_id))
  with check (public.can_edit_lesson(lesson_id));

drop policy if exists delete_attendance on public.attendance;
create policy delete_attendance on public.attendance
  for delete to authenticated
  using (public.is_admin());

-- ===============================================================
-- Права на уровне ролей Postgres
-- Анонимный ключ без входа не должен получать ничего.
-- ===============================================================
revoke all on all tables in schema public from anon;
revoke all on public.enrollments_v from anon;
grant select on public.enrollments_v to authenticated;

-- Новые таблицы в будущем тоже не открываются для anon автоматически
alter default privileges in schema public revoke all on tables from anon;
