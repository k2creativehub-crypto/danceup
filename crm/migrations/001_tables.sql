-- 001_tables.sql
-- Новые таблицы и колонки. Можно запускать повторно (if not exists).
-- Запускать в Supabase -> SQL Editor, целиком, до 002 и 003.

-- ---------------------------------------------------------------
-- profiles: страховочные ограничения (таблица уже есть)
-- ---------------------------------------------------------------
create unique index if not exists profiles_user_id_uidx on public.profiles (user_id);

alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles
  add constraint profiles_role_valid check (role in ('admin', 'teacher'));

alter table public.profiles drop constraint if exists profiles_teacher_required;
alter table public.profiles
  add constraint profiles_teacher_required check (role = 'admin' or teacher_id is not null);

-- ---------------------------------------------------------------
-- groups: архив
-- ---------------------------------------------------------------
alter table public.groups add column if not exists is_archived boolean not null default false;

-- ---------------------------------------------------------------
-- enrollments: даты участия в группе
-- ---------------------------------------------------------------
alter table public.enrollments add column if not exists start_date date;
alter table public.enrollments add column if not exists end_date date;

alter table public.enrollments drop constraint if exists enrollments_dates_valid;
alter table public.enrollments
  add constraint enrollments_dates_valid check (end_date is null or start_date is null or end_date >= start_date);

-- ---------------------------------------------------------------
-- group_schedule: расписание группы (несколько слотов на группу)
-- weekday: 1 = понедельник ... 7 = воскресенье (ISO)
-- ---------------------------------------------------------------
create table if not exists public.group_schedule (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7),
  start_time  time not null,
  end_time    time,
  location    text,
  check (end_time is null or end_time > start_time),
  unique (group_id, weekday, start_time)
);

-- ---------------------------------------------------------------
-- group_prices: цена одного занятия с датой начала действия (история цен)
-- Цена на дату D = строка с максимальным valid_from <= D.
-- ---------------------------------------------------------------
create table if not exists public.group_prices (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  price_kopecks  integer not null check (price_kopecks >= 0),  -- BYN в копейках
  valid_from     date not null,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  unique (group_id, valid_from)
);

-- ---------------------------------------------------------------
-- lessons: занятие группы на дату (одно на группу и дату)
-- ---------------------------------------------------------------
create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  lesson_date  date not null,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (group_id, lesson_date)
);

-- ---------------------------------------------------------------
-- attendance: отметка ученика на занятии (одна на занятие и ученика)
-- present = «+» (платное), absent = «-», sick = «б», trial = «п» пробное (бесплатно)
-- ---------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  mark        text not null check (mark in ('present', 'absent', 'sick', 'trial')),
  marked_by   uuid,                                  -- заполняет триггер
  marked_at   timestamptz not null default now(),    -- заполняет триггер
  unique (lesson_id, student_id)
);

-- ---------------------------------------------------------------
-- payments: фактические оплаты по ученику
-- ---------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete cascade,
  paid_on         date not null,
  amount_kopecks  integer not null check (amount_kopecks > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);

-- ---------------------------------------------------------------
-- Индексы
-- ---------------------------------------------------------------
create index if not exists groups_teacher_idx       on public.groups (teacher_id);
create index if not exists students_guardian_idx    on public.students (guardian_id);
create index if not exists enrollments_group_idx    on public.enrollments (group_id);
create index if not exists attendance_student_idx   on public.attendance (student_id);
create index if not exists payments_student_idx     on public.payments (student_id, paid_on);
create index if not exists group_prices_lookup_idx  on public.group_prices (group_id, valid_from desc);
