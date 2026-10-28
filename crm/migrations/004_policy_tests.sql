-- 004_policy_tests.sql
-- Автотест политик доступа. Ничего не меняет в ваших данных:
-- все тестовые записи создаются внутри подтранзакции, которая в конце откатывается.
--
-- Запуск: сначала выполните этот файл целиком (создаст функцию),
-- затем отдельным запросом:
--     select * from public.run_policy_tests();
-- Каждая строка результата: PASS | FAIL | ERROR, номер теста, пояснение.
-- Ожидаемый итог: последняя строка «ИТОГ: пройдено N из N, FAIL: 0».
--
-- Нужны: в profiles одна запись admin и одна teacher (тестовый учитель),
-- у преподавателя этого учителя есть группа с активным учеником,
-- и есть группа другого преподавателя с активным учеником.

create or replace function public.run_policy_tests()
returns setof text
language plpgsql
as $$
declare
  res text[] := '{}';
  n  bigint;
  n2 bigint;
  n3 bigint;
  s  text;
  v_today date := public.today_minsk();

  v_admin_uid    uuid;
  v_teacher_uid  uuid;
  v_teacher_id   uuid;
  v_own_group    uuid;
  v_own_student  uuid;
  v_other_group  uuid;
  v_other_student uuid;
  v_old_lesson   uuid;
  v_other_lesson uuid;
  v_lesson       uuid;

  tot_groups bigint; tot_enr bigint;
  exp_groups bigint; exp_students bigint; exp_guardians bigint; exp_enr bigint;
  r_fail int; r_pass int;
begin
  begin  -- подтранзакция: всё внутри откатывается в конце
    -- ---------------------------------------------------------
    -- Подготовка (от имени postgres)
    -- ---------------------------------------------------------
    select user_id into v_admin_uid from public.profiles where role = 'admin' limit 1;
    select user_id, teacher_id into v_teacher_uid, v_teacher_id
      from public.profiles where role = 'teacher' limit 1;
    if v_admin_uid is null or v_teacher_uid is null then
      raise exception 'В profiles нужны запись admin и запись teacher';
    end if;

    select g.id, e.student_id into v_own_group, v_own_student
    from public.groups g join public.enrollments e on e.group_id = g.id
    where g.teacher_id = v_teacher_id and e.status = 'active' limit 1;

    select g.id, e.student_id into v_other_group, v_other_student
    from public.groups g join public.enrollments e on e.group_id = g.id
    where g.teacher_id <> v_teacher_id and e.status = 'active'
      and not exists (
        select 1 from public.enrollments e2 join public.groups g2 on g2.id = e2.group_id
        where e2.student_id = e.student_id and g2.teacher_id = v_teacher_id)
    limit 1;

    if v_own_group is null or v_other_group is null then
      raise exception 'Нет подходящих данных: нужна своя и чужая группа с активным учеником';
    end if;

    select count(*) into tot_groups from public.groups;
    select count(*) into tot_enr from public.enrollments;
    select count(*) into exp_groups from public.groups where teacher_id = v_teacher_id;
    select count(*) into exp_enr from public.enrollments e
      join public.groups g on g.id = e.group_id where g.teacher_id = v_teacher_id;
    select count(distinct e.student_id) into exp_students from public.enrollments e
      join public.groups g on g.id = e.group_id where g.teacher_id = v_teacher_id;
    select count(distinct s.guardian_id) into exp_guardians from public.students s
      where s.guardian_id is not null and s.id in (
        select e.student_id from public.enrollments e
        join public.groups g on g.id = e.group_id where g.teacher_id = v_teacher_id);

    insert into public.group_prices (group_id, price_kopecks, valid_from)
      values (v_own_group, 1000, date '2020-01-01');
    insert into public.payments (student_id, paid_on, amount_kopecks)
      values (v_own_student, date '2026-02-01', 1200);
    update public.enrollments set notes = 'SECRET'
      where group_id = v_own_group and student_id = v_own_student;
    insert into public.group_schedule (group_id, weekday, start_time) values
      (v_own_group, 1, time '19:00'), (v_other_group, 2, time '18:00');

    insert into public.lessons (group_id, lesson_date) values (v_own_group, v_today - 10)
      returning id into v_old_lesson;
    insert into public.attendance (lesson_id, student_id, mark)
      values (v_old_lesson, v_own_student, 'present');
    insert into public.lessons (group_id, lesson_date) values (v_other_group, v_today)
      returning id into v_other_lesson;
    insert into public.attendance (lesson_id, student_id, mark)
      values (v_other_lesson, v_other_student, 'present');

    -- ---------------------------------------------------------
    -- УЧИТЕЛЬ
    -- ---------------------------------------------------------
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_teacher_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_teacher_uid::text, true);
    set local role authenticated;

    select count(*) into n from public.groups;
    res := array_append(res, case when n = exp_groups and n < tot_groups then 'PASS' else 'FAIL' end
      || ' | T01 учитель видит только свои группы | видит ' || n || ', ожидается ' || exp_groups
      || ' из ' || tot_groups);

    select count(*) into n from public.groups where id = v_other_group;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T02 чужая группа не видна | ' || n);

    select count(*) into n from public.teachers;
    res := array_append(res, case when n = 1 then 'PASS' else 'FAIL' end
      || ' | T03 из преподавателей виден только он сам | ' || n);

    select count(*) into n from public.students;
    select count(*) into n2 from public.students where id = v_other_student;
    res := array_append(res, case when n = exp_students and n2 = 0 then 'PASS' else 'FAIL' end
      || ' | T04 видны только ученики своих групп | видит ' || n || ', ожидается ' || exp_students
      || ', чужой ученик: ' || n2);

    select count(*) into n from public.guardians;
    res := array_append(res, case when n = exp_guardians then 'PASS' else 'FAIL' end
      || ' | T05 видны только родители детей своих групп | видит ' || n || ', ожидается ' || exp_guardians);

    select count(*) into n from public.group_prices;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T06 цены скрыты | ' || n);

    select count(*) into n from public.payments;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T07 оплаты скрыты | ' || n);

    select count(*) into n from public.enrollments;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T08 таблица enrollments напрямую закрыта | ' || n);

    select count(*), count(*) filter (where notes is not null or contract_number is not null
                                      or contract_date is not null or source_ref is not null)
      into n, n2 from public.enrollments_v;
    select count(*) into n3 from public.enrollments_v where group_id = v_other_group;
    res := array_append(res, case when n = exp_enr and n2 = 0 and n3 = 0 then 'PASS' else 'FAIL' end
      || ' | T09 enrollments_v: только свои, без notes/договора | строк ' || n || ' из ' || exp_enr
      || ', скрытые поля видны в ' || n2 || ', чужих ' || n3);

    select count(*) into n from public.profiles;
    res := array_append(res, case when n = 1 then 'PASS' else 'FAIL' end
      || ' | T10 в profiles виден только свой профиль | ' || n);

    select count(*) filter (where group_id = v_own_group), count(*) filter (where group_id = v_other_group)
      into n, n2 from public.group_schedule;
    res := array_append(res, case when n = 1 and n2 = 0 then 'PASS' else 'FAIL' end
      || ' | T11 расписание: своё видно, чужое нет | своё ' || n || ', чужое ' || n2);

    select count(*) into n from public.lessons where group_id = v_other_group;
    select count(*) into n2 from public.attendance where lesson_id = v_other_lesson;
    res := array_append(res, case when n = 0 and n2 = 0 then 'PASS' else 'FAIL' end
      || ' | T12 занятия и посещаемость чужой группы не видны | занятий ' || n || ', отметок ' || n2);

    -- запреты на запись
    begin
      insert into public.students (id, full_name) values (gen_random_uuid(), 'Тест');
      res := array_append(res, 'FAIL | T13 учитель не может создать ученика | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T13 учитель не может создать ученика | sqlstate ' || sqlstate);
    end;

    update public.groups set name = 'ХАК' where id = v_own_group;
    get diagnostics n = row_count;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T14 учитель не может править группу | изменено строк ' || n);

    begin
      insert into public.group_schedule (group_id, weekday, start_time)
        values (v_own_group, 3, time '10:00');
      res := array_append(res, 'FAIL | T15 учитель не может менять расписание | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T15 учитель не может менять расписание | sqlstate ' || sqlstate);
    end;

    -- посещаемость: разрешено
    perform public.save_attendance(v_own_group, v_today,
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
    select a.marked_by::text into s
      from public.attendance a join public.lessons l on l.id = a.lesson_id
      where l.group_id = v_own_group and l.lesson_date = v_today and a.student_id = v_own_student;
    res := array_append(res, case when s = v_teacher_uid::text then 'PASS' else 'FAIL' end
      || ' | T16 учитель отмечает сегодня, автор записан сервером | marked_by ' || coalesce(s, 'null'));

    perform public.save_attendance(v_own_group, v_today,
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'absent')));
    select count(*) into n from public.lessons where group_id = v_own_group and lesson_date = v_today;
    select count(*), min(a.mark) into n2, s
      from public.attendance a join public.lessons l on l.id = a.lesson_id
      where l.group_id = v_own_group and l.lesson_date = v_today and a.student_id = v_own_student;
    res := array_append(res, case when n = 1 and n2 = 1 and s = 'absent' then 'PASS' else 'FAIL' end
      || ' | T17 повторное сохранение обновляет, не дублирует | занятий ' || n || ', отметок ' || n2
      || ', mark ' || coalesce(s, 'null'));

    begin
      perform public.save_attendance(v_own_group, v_today - 3,
        jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
      res := array_append(res, 'PASS | T18 можно править 3 дня назад | ок');
    exception when others then
      res := array_append(res, 'FAIL | T18 можно править 3 дня назад | sqlstate ' || sqlstate || ' ' || sqlerrm);
    end;

    begin
      perform public.save_attendance(v_own_group, v_today - 4,
        jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
      res := array_append(res, 'FAIL | T19 4 дня назад запрещено | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T19 4 дня назад запрещено | sqlstate ' || sqlstate);
    end;

    begin
      perform public.save_attendance(v_own_group, v_today + 1,
        jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
      res := array_append(res, 'FAIL | T20 будущая дата запрещена | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T20 будущая дата запрещена | sqlstate ' || sqlstate);
    end;

    begin
      perform public.save_attendance(v_other_group, v_today,
        jsonb_build_array(jsonb_build_object('student_id', v_other_student, 'mark', 'present')));
      res := array_append(res, 'FAIL | T21 чужая группа запрещена | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T21 чужая группа запрещена | sqlstate ' || sqlstate);
    end;

    begin
      perform public.save_attendance(v_own_group, v_today - 1,
        jsonb_build_array(jsonb_build_object('student_id', v_other_student, 'mark', 'present')));
      res := array_append(res, 'FAIL | T22 ученика не из группы отметить нельзя | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate in ('P0001', '42501') then 'PASS' else 'FAIL' end
        || ' | T22 ученика не из группы отметить нельзя | sqlstate ' || sqlstate);
    end;

    update public.attendance set mark = 'absent' where lesson_id = v_old_lesson;
    get diagnostics n = row_count;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T23 занятие старше 3 дней учитель править не может | изменено ' || n);

    delete from public.attendance
      where lesson_id in (select id from public.lessons where group_id = v_own_group and lesson_date = v_today);
    get diagnostics n = row_count;
    res := array_append(res, case when n = 0 then 'PASS' else 'FAIL' end
      || ' | T24 учитель не может удалять отметки | удалено ' || n);

    begin
      perform * from public.invoice_lines(date '2026-01-01', date '2026-01-31', null);
      res := array_append(res, 'FAIL | T25 учитель не получает счета | функция выполнилась');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T25 учитель не получает счета | sqlstate ' || sqlstate);
    end;

    begin
      perform * from public.student_balances(date '2026-12-31');
      res := array_append(res, 'FAIL | T26 учитель не видит балансы | функция выполнилась');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T26 учитель не видит балансы | sqlstate ' || sqlstate);
    end;

    begin
      perform public.admin_link_account('nobody@example.com', 'admin', null);
      res := array_append(res, 'FAIL | T27 учитель не может выдавать роли | функция выполнилась');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | T27 учитель не может выдавать роли | sqlstate ' || sqlstate);
    end;

    -- ---------------------------------------------------------
    -- АДМИН (смена claims, роль Postgres та же: authenticated)
    -- ---------------------------------------------------------
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);

    select count(*) into n from public.groups;
    select count(*) into n2 from public.enrollments;
    res := array_append(res, case when n = tot_groups and n2 = tot_enr then 'PASS' else 'FAIL' end
      || ' | A01 админ видит все группы и зачисления | групп ' || n || ' из ' || tot_groups
      || ', зачислений ' || n2 || ' из ' || tot_enr);

    select notes into s from public.enrollments_v
      where group_id = v_own_group and student_id = v_own_student;
    res := array_append(res, case when s = 'SECRET' then 'PASS' else 'FAIL' end
      || ' | A02 админ видит заметки через enrollments_v | ' || coalesce(s, 'null'));

    -- счёт: цена 1000 с 2020-01-01, затем 1500 с 2026-01-20
    perform public.save_attendance(v_own_group, date '2026-01-10',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
    perform public.save_attendance(v_own_group, date '2026-01-17',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
    insert into public.group_prices (group_id, price_kopecks, valid_from)
      values (v_own_group, 1500, date '2026-01-20');
    perform public.save_attendance(v_own_group, date '2026-01-24',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
    perform public.save_attendance(v_own_group, date '2026-01-25',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'sick')));
    perform public.save_attendance(v_own_group, date '2026-01-26',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'trial')));

    select lessons_count, amount_kopecks, lessons_without_price into n, n2, n3
      from public.invoice_lines(date '2026-01-01', date '2026-01-31', v_own_group)
      where student_id = v_own_student;
    res := array_append(res, case when n = 3 and n2 = 3500 and n3 = 0 then 'PASS' else 'FAIL' end
      || ' | A03 счёт: 3 платных занятия, 1000+1000+1500 = 3500 (б и пробное не платные) | занятий '
      || n || ', сумма ' || n2 || ', без цены ' || n3);

    select charged_kopecks, paid_kopecks, debt_kopecks into n, n2, n3
      from public.student_balances(date '2026-02-28') where student_id = v_own_student;
    res := array_append(res, case when n = 3500 and n2 = 1200 and n3 = 2300 then 'PASS' else 'FAIL' end
      || ' | A04 баланс: начислено 3500, оплачено 1200, долг 2300 | ' || n || ' / ' || n2 || ' / ' || n3);

    perform public.save_attendance(v_own_group, date '2019-12-30',
      jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'present')));
    select lessons_count, amount_kopecks, lessons_without_price into n, n2, n3
      from public.invoice_lines(date '2019-12-01', date '2019-12-31', v_own_group)
      where student_id = v_own_student;
    res := array_append(res, case when n = 1 and n2 = 0 and n3 = 1 then 'PASS' else 'FAIL' end
      || ' | A05 занятие до первой цены помечается «без цены» | занятий ' || n || ', сумма ' || n2
      || ', без цены ' || n3);

    begin
      perform public.save_attendance(v_own_group, date '2026-01-12',
        jsonb_build_array(jsonb_build_object('student_id', v_own_student, 'mark', 'x')));
      res := array_append(res, 'FAIL | A06 неизвестная отметка отклоняется | запись прошла');
    exception when others then
      res := array_append(res, case when sqlstate = '23514' then 'PASS' else 'FAIL' end
        || ' | A06 неизвестная отметка отклоняется | sqlstate ' || sqlstate);
    end;

    delete from public.attendance
      where lesson_id in (select id from public.lessons
                          where group_id = v_own_group and lesson_date = date '2026-01-26');
    get diagnostics n = row_count;
    res := array_append(res, case when n = 1 then 'PASS' else 'FAIL' end
      || ' | A07 админ может удалять отметки | удалено ' || n);

    begin
      perform public.admin_link_account('nobody@example.com', 'admin', null);
      res := array_append(res, 'FAIL | A08 привязка несуществующего e-mail | ошибки нет');
    exception when others then
      res := array_append(res, case when sqlstate = 'P0001' then 'PASS' else 'FAIL' end
        || ' | A08 админ вызывает привязку, несуществующий e-mail отклоняется | sqlstate ' || sqlstate);
    end;

    -- ---------------------------------------------------------
    -- ГОСТЬ (anon, без входа)
    -- ---------------------------------------------------------
    reset role;
    set local role anon;

    begin
      perform count(*) from public.groups;
      res := array_append(res, 'FAIL | G01 anon не читает таблицы | чтение прошло');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | G01 anon не читает таблицы | sqlstate ' || sqlstate);
    end;

    begin
      perform count(*) from public.enrollments_v;
      res := array_append(res, 'FAIL | G02 anon не читает enrollments_v | чтение прошло');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | G02 anon не читает enrollments_v | sqlstate ' || sqlstate);
    end;

    begin
      perform public.is_admin();
      res := array_append(res, 'FAIL | G03 anon не вызывает функции | вызов прошёл');
    exception when others then
      res := array_append(res, case when sqlstate = '42501' then 'PASS' else 'FAIL' end
        || ' | G03 anon не вызывает функции | sqlstate ' || sqlstate);
    end;

    reset role;
    raise exception using errcode = 'XX999', message = 'rollback tests';  -- откат всех тестовых данных
  exception when others then
    if sqlstate <> 'XX999' then
      res := array_append(res, 'ERROR | тест прерван: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  select count(*) filter (where r like 'PASS%'),
         count(*) filter (where r like 'FAIL%' or r like 'ERROR%')
    into r_pass, r_fail from unnest(res) as r;
  res := array_append(res, 'ИТОГ: пройдено ' || r_pass || ' из ' || (r_pass + r_fail)
    || ', FAIL: ' || r_fail);

  return query select x from unnest(res) as x;
end;
$$;

-- Функцию может вызывать только владелец (SQL Editor). Из приложения она недоступна.
revoke all on function public.run_policy_tests() from public, anon, authenticated;

-- После успешной проверки функцию можно удалить:
-- drop function public.run_policy_tests();
