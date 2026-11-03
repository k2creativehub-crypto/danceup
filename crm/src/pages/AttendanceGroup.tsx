import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { MARKS, SYMBOL, enrolledOn } from '../lib/attendance';
import type { Mark } from '../lib/attendance';
import {
  addDays,
  datesInMonth,
  dayNum,
  formatLong,
  formatMonth,
  isoWeekday,
  monthBounds,
  monthOf,
  shiftMonth,
  weekdayShort,
} from '../lib/dates';
import { ageYears, pluralYears, timeHM, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';

// В базе хранятся только исключения («−», «б», «п»). Кто не указан, у того «+».
interface LessonData {
  id: string;
  cancelled: boolean;
  marks: Map<string, Mark>;
}
interface MonthData {
  key: string;
  lessons: Map<string, LessonData>;
}
interface LessonRow {
  id: string;
  lesson_date: string;
  is_cancelled: boolean;
  attendance: { student_id: string; mark: Mark }[];
}

const EMPTY_LESSONS: Map<string, LessonData> = new Map();

function friendlyError(e: { code?: string; message: string }): string {
  if (e.code === '42501') return 'Править эту дату нельзя. Учитель может менять сегодняшний день и 3 предыдущих.';
  return e.message;
}

export default function AttendanceGroup() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const dir = useDirectory();
  const today = todayMinsk();

  const [ym, setYm] = useState(monthOf(today));
  const [tab, setTab] = useState<'lesson' | 'month'>('lesson');
  const [selected, setSelected] = useState<string | null>(null);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [month, setMonth] = useState<MonthData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [addingDate, setAddingDate] = useState(false);
  const [newDate, setNewDate] = useState(today);

  const group = dir.groupById.get(groupId);
  const slots = useMemo(() => dir.slotsByGroup.get(groupId) ?? [], [dir.slotsByGroup, groupId]);
  const enrs = useMemo(() => dir.enrollmentsByGroup.get(groupId) ?? [], [dir.enrollmentsByGroup, groupId]);
  const key = `${groupId}|${ym}`;
  const monthReady = month !== null && month.key === key;
  const lessonsMap: Map<string, LessonData> = useMemo(
    () => (month !== null && month.key === key ? month.lessons : EMPTY_LESSONS),
    [month, key],
  );

  const canEdit = useCallback(
    (d: string) => isAdmin || (d <= today && d >= addDays(today, -3)),
    [isAdmin, today],
  );

  const load = useCallback(async () => {
    if (!groupId) return;
    const { from, to } = monthBounds(ym);
    const { data, error: e } = await supabase
      .from('lessons')
      .select('id, lesson_date, is_cancelled, attendance(student_id, mark)')
      .eq('group_id', groupId)
      .gte('lesson_date', from)
      .lte('lesson_date', to);
    if (e) return setLoadError(e.message);
    setLoadError(null);
    const lessons = new Map<string, LessonData>();
    for (const l of (data ?? []) as unknown as LessonRow[]) {
      lessons.set(l.lesson_date, {
        id: l.id,
        cancelled: l.is_cancelled,
        marks: new Map<string, Mark>(l.attendance.filter((a) => a.mark !== 'present').map((a) => [a.student_id, a.mark])),
      });
    }
    setMonth({ key: `${groupId}|${ym}`, lessons });
  }, [groupId, ym]);

  useEffect(() => {
    void load();
  }, [load]);

  // Даты занятий месяца: по расписанию, плюс внеплановые с изменениями и добавленные вручную.
  const dates = useMemo(() => {
    const wds = new Set(slots.map((s) => s.weekday));
    const set = new Set<string>(datesInMonth(ym).filter((d) => wds.has(isoWeekday(d))));
    for (const [d, l] of lessonsMap) if (l.marks.size > 0 || l.cancelled) set.add(d);
    for (const d of extraDates) if (monthOf(d) === ym) set.add(d);
    return [...set].sort();
  }, [slots, ym, lessonsMap, extraDates]);

  const timeFor = useCallback(
    (d: string): string | null => {
      const s = slots.filter((x) => x.weekday === isoWeekday(d)).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      return s ? timeHM(s.start_time) : null;
    },
    [slots],
  );

  const isExtra = useCallback((d: string) => !slots.some((s) => s.weekday === isoWeekday(d)), [slots]);

  // Выбор даты по умолчанию.
  useEffect(() => {
    if (!monthReady) return;
    if (selected && dates.includes(selected)) return;
    if (dates.length === 0) return setSelected(null);
    const cur = monthOf(today);
    let pick = dates[0];
    if (ym === cur) {
      const past = dates.filter((d) => d <= today);
      pick = past.length > 0 ? past[past.length - 1] : dates[0];
    } else if (ym < cur) {
      pick = dates[dates.length - 1];
    }
    setSelected(pick);
  }, [monthReady, dates, selected, ym, today]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  const nameOf = useCallback((id: string) => dir.studentById.get(id)?.full_name ?? 'Ученик', [dir.studentById]);

  // Ученики на дату: кто состоит в группе в этот день, и те, у кого уже есть исключение.
  const rosterFor = useCallback(
    (d: string) => {
      const saved = lessonsMap.get(d);
      const ids = new Set<string>();
      const enrolled = new Set<string>();
      for (const e of enrs) {
        if (enrolledOn(e, d)) {
          ids.add(e.student_id);
          enrolled.add(e.student_id);
        }
      }
      if (saved) for (const id of saved.marks.keys()) ids.add(id);
      return [...ids]
        .map((id) => ({ id, enrolled: enrolled.has(id) }))
        .sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id), 'ru'));
    },
    [enrs, lessonsMap, nameOf],
  );

  const markOf = (d: string, sid: string): Mark => lessonsMap.get(d)?.marks.get(sid) ?? 'present';

  const changeMonth = (delta: number) => {
    setSelected(null);
    setYm(shiftMonth(ym, delta));
  };
  const goToday = () => {
    setSelected(null);
    setYm(monthOf(today));
  };

  // Одна отметка: сразу на экране, затем в базе. «+» в базе не хранится: он снимает исключение.
  const setMark = async (d: string, studentId: string, mark: Mark) => {
    setError(null);
    setMonth((m: MonthData | null) => {
      if (!m) return m;
      const lessons = new Map<string, LessonData>(m.lessons);
      const cur = lessons.get(d);
      const marks = new Map<string, Mark>(cur?.marks ?? []);
      if (mark === 'present') marks.delete(studentId);
      else marks.set(studentId, mark);
      lessons.set(d, { id: cur?.id ?? '', cancelled: cur?.cancelled ?? false, marks });
      return { ...m, lessons };
    });
    const { error: e } = await supabase.rpc('save_attendance', {
      p_group_id: groupId,
      p_date: d,
      p_marks: [{ student_id: studentId, mark }],
    });
    if (e) setError(friendlyError(e));
    else setFlash('Сохранено');
    await load();
  };

  const cancelLesson = async (d: string) => {
    if (!window.confirm(`Занятие ${formatLong(d)} не состоялось? Оно не будет учтено в счёте, отметки за этот день снимутся.`)) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('cancel_lesson', { p_group_id: groupId, p_date: d });
    if (e) setError(friendlyError(e));
    else setFlash('Занятие отмечено как не состоявшееся');
    await load();
    setBusy(false);
  };

  const restoreLesson = async (d: string) => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('restore_lesson', { p_group_id: groupId, p_date: d });
    if (e) setError(friendlyError(e));
    else setFlash('Занятие возвращено');
    await load();
    setBusy(false);
  };

  const addDate = () => {
    if (!newDate) return;
    if (!canEdit(newDate)) {
      return setError('Эту дату учитель добавить не может: доступны сегодня и 3 предыдущих дня.');
    }
    setError(null);
    setExtraDates((list) => (list.includes(newDate) ? list : [...list, newDate]));
    setYm(monthOf(newDate));
    setSelected(newDate);
    setAddingDate(false);
  };

  if (dir.error) return <p className="error">Не удалось загрузить данные: {dir.error}</p>;
  if (dir.loading) return <p className="muted">Загрузка…</p>;
  if (!group) {
    return (
      <div>
        <button className="btn btn-sm" onClick={() => navigate('/attendance')}>
          ← К списку групп
        </button>
        <p className="muted" style={{ marginTop: 16 }}>
          Группа не найдена или нет доступа.
        </p>
      </div>
    );
  }

  const selLesson = selected ? lessonsMap.get(selected) : undefined;
  const cancelled = !!selLesson?.cancelled;
  const editable = selected ? canEdit(selected) : false;
  const roster = selected && monthReady ? rosterFor(selected) : [];
  const counts = { present: 0, absent: 0, sick: 0, trial: 0 };
  if (selected) for (const r of roster) counts[markOf(selected, r.id)] += 1;

  // Таблица за месяц
  const monthStudentIds = (() => {
    const ids = new Set<string>();
    for (const d of dates) for (const r of rosterFor(d)) ids.add(r.id);
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ru'));
  })();
  const enrolledSets = new Map<string, Set<string>>(
    dates.map((d) => [d, new Set(rosterFor(d).filter((r) => r.enrolled).map((r) => r.id))]),
  );

  return (
    <div className="att-page">
      <button className="btn btn-sm back-btn" onClick={() => navigate('/attendance')}>
        ← К списку групп
      </button>
      <h1>{group.name}</h1>
      <p className="muted subtitle">
        {group.teacher?.full_name ?? 'преподаватель не указан'}
        {!isAdmin && ' · правка: сегодня и 3 предыдущих дня'}
      </p>

      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => changeMonth(-1)}>
          ‹
        </button>
        <div className="month-title">{formatMonth(ym)}</div>
        <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => changeMonth(1)}>
          ›
        </button>
        {ym !== monthOf(today) && (
          <button type="button" className="btn btn-sm" onClick={goToday}>
            Текущий месяц
          </button>
        )}
      </div>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'lesson'}
          className={`tab${tab === 'lesson' ? ' is-active' : ''}`}
          onClick={() => setTab('lesson')}
        >
          Занятие
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'month'}
          className={`tab${tab === 'month' ? ' is-active' : ''}`}
          onClick={() => setTab('month')}
        >
          Месяц
        </button>
      </div>

      {loadError && <p className="error">Не удалось загрузить отметки: {loadError}</p>}
      {error && <p className="error">{error}</p>}
      {flash && <p className="att-flash">{flash}</p>}

      {!monthReady && !loadError && (
        <div>
          <span className="skeleton skeleton-line" style={{ width: '70%' }} />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      )}

      {monthReady && dates.length === 0 && (
        <div className="panel">
          <p>
            В этом месяце у группы нет занятий: расписание не задано
            {isAdmin && (
              <>
                {' '}
                (его можно добавить в разделе <Link to="/pricing">«Цены и расписание»</Link>)
              </>
            )}
            . Внеплановое занятие можно отметить кнопкой «+ Другая дата».
          </p>
        </div>
      )}

      {monthReady && tab === 'lesson' && (
        <>
          {dates.length > 0 && (
            <div className="date-chips">
              {dates.map((d) => {
                const l = lessonsMap.get(d);
                const changed = !!l && l.marks.size > 0;
                return (
                  <button
                    type="button"
                    key={d}
                    className={`date-chip${d === selected ? ' is-selected' : ''}${d === today ? ' is-today' : ''}${changed ? ' is-changed' : ''}${l?.cancelled ? ' is-cancelled' : ''}`}
                    onClick={() => setSelected(d)}
                    title={`${formatLong(d)}${isExtra(d) ? ' (вне расписания)' : ''}${l?.cancelled ? ': не состоялось' : ''}`}
                  >
                    <span className="date-chip-wd">{weekdayShort(d)}</span>
                    <span className="date-chip-day">{dayNum(d)}</span>
                    <span className="date-chip-dot" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="att-extra">
            {!addingDate ? (
              <button type="button" className="btn btn-sm" onClick={() => setAddingDate(true)}>
                + Другая дата
              </button>
            ) : (
              <div className="inline-form add-date-form">
                <input
                  type="date"
                  value={newDate}
                  min={isAdmin ? undefined : addDays(today, -3)}
                  max={isAdmin ? undefined : today}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={addDate}>
                  Добавить
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAddingDate(false)}>
                  Отмена
                </button>
              </div>
            )}
          </div>

          {selected && (
            <section className="panel att-lesson">
              <div className="att-lesson-head">
                <h2>
                  {formatLong(selected)}
                  {timeFor(selected) && <span className="muted"> · {timeFor(selected)}</span>}
                  {isExtra(selected) && <span className="badge badge-extra">вне расписания</span>}
                </h2>
                <span className={`att-status ${cancelled ? 'is-cancelled' : ''}`}>
                  {cancelled ? 'Не состоялось' : (selLesson?.marks.size ?? 0) > 0 ? `Исключений: ${selLesson?.marks.size}` : 'Все «+»'}
                </span>
              </div>

              {!editable && (
                <p className="att-notice">
                  {selected > today
                    ? 'Это занятие ещё не наступило. Отмечать можно сегодня и за 3 предыдущих дня.'
                    : 'Править прошлые даты может только администратор. Отметки показаны для просмотра.'}
                </p>
              )}

              {cancelled ? (
                <div>
                  <p className="att-notice">Занятие не состоялось. Оно не оплачивается и не входит в счёт.</p>
                  {editable && (
                    <button type="button" className="btn btn-sm" onClick={() => restoreLesson(selected)} disabled={busy}>
                      Вернуть занятие
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {editable && (
                    <p className="muted small">
                      Всем стоит «+». Изменяйте только отсутствующих: каждое изменение сохраняется сразу.
                      {isExtra(selected) && ' Внеплановое занятие в счёт не входит.'}
                    </p>
                  )}

                  {roster.length === 0 && <p className="muted">На эту дату в группе нет учеников.</p>}

                  <div className="att-list">
                    {roster.map((r) => {
                      const st = dir.studentById.get(r.id);
                      const age = st ? ageYears(st.birth_date) : null;
                      const current = markOf(selected, r.id);
                      const can = editable && r.enrolled;
                      return (
                        <div key={r.id} className="att-row">
                          <div className="att-name">
                            {st?.full_name ?? 'Ученик'}
                            {age !== null && <span className="muted"> · {pluralYears(age)}</span>}
                            {!r.enrolled && <span className="muted small"> · не состоял в группе в этот день</span>}
                          </div>
                          <div className="mark-btns" role="group" aria-label="Отметка">
                            {MARKS.map((m) => (
                              <button
                                type="button"
                                key={m.value}
                                className={`mark-btn mark-${m.value}${current === m.value ? ' is-on' : ''}`}
                                disabled={!can}
                                title={m.label}
                                aria-pressed={current === m.value}
                                onClick={() => {
                                  if (current !== m.value) void setMark(selected, r.id, m.value);
                                }}
                              >
                                {m.symbol}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {roster.length > 0 && (
                    <p className="muted small att-counts">
                      Были: {counts.present} · не были: {counts.absent} · болеют: {counts.sick} · пробное: {counts.trial}
                    </p>
                  )}

                  {editable && (
                    <div className="field-actions att-actions">
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => cancelLesson(selected)} disabled={busy}>
                        Занятие не состоялось
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}

      {monthReady && tab === 'month' && dates.length > 0 && (
        <>
          <p className="muted small">
            Всем стоит «+». Нажмите на ячейку, чтобы выбрать другую отметку: она сохранится сразу. Нажмите на дату, чтобы
            открыть занятие целиком.
          </p>
          <div className="att-grid-wrap">
            <table className="att-grid">
              <thead>
                <tr>
                  <th className="att-sticky">Ученик</th>
                  {dates.map((d) => (
                    <th key={d} className={d === today ? 'is-today' : ''}>
                      <button
                        type="button"
                        className="att-date-btn"
                        onClick={() => {
                          setSelected(d);
                          setTab('lesson');
                        }}
                        title={isExtra(d) ? 'Вне расписания' : formatLong(d)}
                      >
                        <span>{weekdayShort(d)}</span>
                        <strong>{dayNum(d)}</strong>
                      </button>
                      {lessonsMap.get(d)?.cancelled && <span className="att-cancel-tag">отмена</span>}
                    </th>
                  ))}
                  <th className="att-total">«+»</th>
                </tr>
              </thead>
              <tbody>
                {monthStudentIds.map((sid) => {
                  let pluses = 0;
                  return (
                    <tr key={sid}>
                      <td className="att-sticky att-student">{nameOf(sid)}</td>
                      {dates.map((d) => {
                        const isCancelled = !!lessonsMap.get(d)?.cancelled;
                        const enrolled = enrolledSets.get(d)?.has(sid) ?? false;
                        const mark = markOf(d, sid);
                        if (!isCancelled && enrolled && mark === 'present') pluses += 1;
                        const can = canEdit(d) && enrolled && !isCancelled;
                        if (isCancelled || !enrolled) {
                          return (
                            <td key={d} className={d === today ? 'is-today' : ''}>
                              <span className="cell-empty">{isCancelled ? '✕' : '–'}</span>
                            </td>
                          );
                        }
                        if (!can) {
                          return (
                            <td key={d} className={d === today ? 'is-today' : ''}>
                              <span className={`cell-mark mark-${mark}`}>{SYMBOL[mark]}</span>
                            </td>
                          );
                        }
                        return (
                          <td key={d} className={d === today ? 'is-today' : ''}>
                            <select
                              className={`cell-select mark-${mark}`}
                              value={mark}
                              aria-label={`${nameOf(sid)}, ${formatLong(d)}`}
                              onChange={(e) => void setMark(d, sid, e.target.value as Mark)}
                            >
                              {MARKS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.symbol}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      <td className="att-total">{pluses}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
