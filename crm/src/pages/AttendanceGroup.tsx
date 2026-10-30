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

interface LessonData {
  id: string;
  marks: Map<string, Mark>;
}
interface MonthData {
  key: string;
  lessons: Map<string, LessonData>;
}
interface LessonRow {
  id: string;
  lesson_date: string;
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
  const [draft, setDraft] = useState<Record<string, Mark>>({});
  const [dirty, setDirty] = useState(false);
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
      .select('id, lesson_date, attendance(student_id, mark)')
      .eq('group_id', groupId)
      .gte('lesson_date', from)
      .lte('lesson_date', to);
    if (e) return setLoadError(e.message);
    setLoadError(null);
    const lessons = new Map<string, LessonData>();
    for (const l of (data ?? []) as unknown as LessonRow[]) {
      lessons.set(l.lesson_date, { id: l.id, marks: new Map(l.attendance.map((a) => [a.student_id, a.mark])) });
    }
    setMonth({ key: `${groupId}|${ym}`, lessons });
  }, [groupId, ym]);

  useEffect(() => {
    void load();
  }, [load]);

  // Даты занятий месяца: по расписанию + уже отмеченные + добавленные вручную.
  const dates = useMemo(() => {
    const wds = new Set(slots.map((s) => s.weekday));
    const set = new Set<string>(datesInMonth(ym).filter((d) => wds.has(isoWeekday(d))));
    for (const [d, l] of lessonsMap) if (l.marks.size > 0) set.add(d);
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

  const nameOf = useCallback((id: string) => dir.studentById.get(id)?.full_name ?? 'Ученик', [dir.studentById]);

  // Список учеников на дату: те, кто состоит в группе в этот день, и те, у кого уже есть отметка.
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

  // Черновик занятия: сохранённые отметки, остальным по умолчанию «+».
  useEffect(() => {
    if (!selected || !monthReady) return;
    const saved = lessonsMap.get(selected);
    const next: Record<string, Mark> = {};
    for (const r of rosterFor(selected)) next[r.id] = saved?.marks.get(r.id) ?? 'present';
    setDraft(next);
    setDirty(false);
  }, [selected, lessonsMap, monthReady, rosterFor]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const leaveOk = () => !dirty || window.confirm('Несохранённые отметки будут потеряны. Продолжить?');

  const changeMonth = (delta: number) => {
    if (!leaveOk()) return;
    setSelected(null);
    setYm(shiftMonth(ym, delta));
  };
  const goToday = () => {
    if (!leaveOk()) return;
    setSelected(null);
    setYm(monthOf(today));
  };
  const selectDate = (d: string) => {
    if (d === selected || !leaveOk()) return;
    setSelected(d);
  };

  const saveLesson = async () => {
    if (!selected) return;
    const marks = rosterFor(selected)
      .filter((r) => r.enrolled)
      .map((r) => ({ student_id: r.id, mark: draft[r.id] ?? 'present' }));
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('save_attendance', { p_group_id: groupId, p_date: selected, p_marks: marks });
    if (e) {
      setBusy(false);
      return setError(friendlyError(e));
    }
    await load();
    setBusy(false);
    setFlash('Сохранено');
  };

  const cancelLesson = async () => {
    if (!selected) return;
    if (!window.confirm(`Снять все отметки за ${formatLong(selected)}? Занятие не будет учтено в счёте.`)) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('cancel_lesson', { p_group_id: groupId, p_date: selected });
    if (e) {
      setBusy(false);
      return setError(friendlyError(e));
    }
    setExtraDates((list) => list.filter((d) => d !== selected));
    await load();
    setBusy(false);
    setFlash('Отметки сняты');
  };

  const addDate = () => {
    if (!newDate) return;
    if (!canEdit(newDate)) {
      return setError('Эту дату учитель добавить не может: доступны сегодня и 3 предыдущих дня.');
    }
    if (!leaveOk()) return;
    setError(null);
    setExtraDates((list) => (list.includes(newDate) ? list : [...list, newDate]));
    setYm(monthOf(newDate));
    setSelected(newDate);
    setAddingDate(false);
  };

  // Одна отметка в журнале за месяц: сразу в интерфейсе, затем в базу.
  const setCell = async (d: string, studentId: string, mark: Mark) => {
    setError(null);
    setMonth((m: MonthData | null) => {
      if (!m) return m;
      const lessons = new Map<string, LessonData>(m.lessons);
      const cur = lessons.get(d);
      const marks = new Map<string, Mark>(cur?.marks ?? []);
      marks.set(studentId, mark);
      lessons.set(d, { id: cur?.id ?? '', marks });
      return { ...m, lessons };
    });
    const { error: e } = await supabase.rpc('save_attendance', {
      p_group_id: groupId,
      p_date: d,
      p_marks: [{ student_id: studentId, mark }],
    });
    if (e) setError(friendlyError(e));
    await load();
  };

  const markAllPresent = async (d: string) => {
    const saved = lessonsMap.get(d);
    const marks = rosterFor(d)
      .filter((r) => r.enrolled && !saved?.marks.has(r.id))
      .map((r) => ({ student_id: r.id, mark: 'present' as Mark }));
    if (marks.length === 0) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('save_attendance', { p_group_id: groupId, p_date: d, p_marks: marks });
    if (e) setError(friendlyError(e));
    await load();
    setBusy(false);
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

  const savedLesson = selected ? lessonsMap.get(selected) : undefined;
  const lessonIsSaved = !!savedLesson && savedLesson.marks.size > 0;
  const editable = selected ? canEdit(selected) : false;
  const roster = selected && monthReady ? rosterFor(selected) : [];
  const counts = { present: 0, absent: 0, sick: 0, trial: 0 };
  for (const r of roster) counts[draft[r.id] ?? 'present'] += 1;

  // Таблица за месяц
  const monthStudentIds = (() => {
    const ids = new Set<string>();
    for (const d of dates) for (const r of rosterFor(d)) ids.add(r.id);
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ru'));
  })();
  const enrolledSets = new Map<string, Set<string>>(dates.map((d) => [d, new Set(rosterFor(d).filter((r) => r.enrolled).map((r) => r.id))]));

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
          onClick={() => {
            if (leaveOk()) setTab('month');
          }}
        >
          Месяц
        </button>
      </div>

      {loadError && <p className="error">Не удалось загрузить отметки: {loadError}</p>}
      {error && <p className="error">{error}</p>}

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
                const marked = !!l && l.marks.size > 0;
                return (
                  <button
                    type="button"
                    key={d}
                    className={`date-chip${d === selected ? ' is-selected' : ''}${d === today ? ' is-today' : ''}${marked ? ' is-marked' : ''}`}
                    onClick={() => selectDate(d)}
                    title={`${formatLong(d)}${isExtra(d) ? ' (вне расписания)' : ''}`}
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
                <span className={`att-status ${lessonIsSaved ? 'is-saved' : ''}`}>
                  {lessonIsSaved ? 'Отмечено' : 'Ещё не отмечено'}
                </span>
              </div>

              {!editable && (
                <p className="att-notice">
                  {selected > today
                    ? 'Это занятие ещё не наступило. Отмечать можно сегодня и за 3 предыдущих дня.'
                    : 'Править прошлые даты может только администратор. Отметки показаны для просмотра.'}
                </p>
              )}
              {editable && !lessonIsSaved && (
                <p className="muted small">
                  Всем стоит «+» по умолчанию, но пока вы не нажмёте «Сохранить», в базу ничего не записано. Измените
                  отсутствующих.
                </p>
              )}

              {roster.length === 0 && <p className="muted">На эту дату в группе нет учеников.</p>}

              <div className="att-list">
                {roster.map((r) => {
                  const st = dir.studentById.get(r.id);
                  const age = st ? ageYears(st.birth_date) : null;
                  const current = draft[r.id] ?? 'present';
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
                            disabled={!can || busy}
                            title={m.label}
                            aria-pressed={current === m.value}
                            onClick={() => {
                              setDraft((dr) => ({ ...dr, [r.id]: m.value }));
                              setDirty(true);
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

              {editable && roster.some((r) => r.enrolled) && (
                <div className="field-actions att-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveLesson}
                    disabled={busy || (lessonIsSaved && !dirty)}
                  >
                    {busy ? 'Сохраняем…' : lessonIsSaved && !dirty ? 'Сохранено' : 'Сохранить'}
                  </button>
                  {lessonIsSaved && (
                    <button type="button" className="btn btn-danger" onClick={cancelLesson} disabled={busy}>
                      Занятие не состоялось
                    </button>
                  )}
                  {flash && <span className="att-flash">{flash}</span>}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {monthReady && tab === 'month' && dates.length > 0 && (
        <>
          <p className="muted small">
            Нажмите на ячейку, чтобы выбрать отметку, она сохранится сразу. Пустая ячейка не оплачивается. Нажмите на дату,
            чтобы открыть занятие целиком.
          </p>
          <div className="att-grid-wrap">
            <table className="att-grid">
              <thead>
                <tr>
                  <th className="att-sticky">Ученик</th>
                  {dates.map((d) => {
                    const saved = lessonsMap.get(d);
                    const needAll =
                      canEdit(d) && rosterFor(d).some((r) => r.enrolled && !saved?.marks.has(r.id));
                    return (
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
                        {needAll && (
                          <button type="button" className="att-all" onClick={() => markAllPresent(d)} disabled={busy} title="Поставить «+» всем без отметки">
                            все +
                          </button>
                        )}
                      </th>
                    );
                  })}
                  <th className="att-total">Оплач.</th>
                </tr>
              </thead>
              <tbody>
                {monthStudentIds.map((sid) => {
                  let paid = 0;
                  return (
                    <tr key={sid}>
                      <td className="att-sticky att-student">{nameOf(sid)}</td>
                      {dates.map((d) => {
                        const mark = lessonsMap.get(d)?.marks.get(sid);
                        if (mark === 'present') paid += 1;
                        const enrolled = enrolledSets.get(d)?.has(sid) ?? false;
                        const can = canEdit(d) && enrolled;
                        if (!can) {
                          return (
                            <td key={d} className={d === today ? 'is-today' : ''}>
                              {mark ? (
                                <span className={`cell-mark mark-${mark}`}>{SYMBOL[mark]}</span>
                              ) : (
                                <span className="cell-empty">{enrolled ? '' : '–'}</span>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td key={d} className={d === today ? 'is-today' : ''}>
                            <select
                              className={`cell-select${mark ? ` mark-${mark}` : ''}`}
                              value={mark ?? ''}
                              aria-label={`${nameOf(sid)}, ${formatLong(d)}`}
                              onChange={(e) => void setCell(d, sid, e.target.value as Mark)}
                            >
                              <option value="" disabled={!!mark}>
                                ·
                              </option>
                              {MARKS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.symbol}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      <td className="att-total">{paid}</td>
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
