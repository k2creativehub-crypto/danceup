import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { isoWeekday } from '../lib/dates';
import { pluralStudents, scheduleLabels, timeHM, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

export default function Attendance() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { groups, enrollments, slotsByGroup, loading, error } = useDirectory();
  const today = todayMinsk();
  const todayWd = isoWeekday(today);

  const [query, setQuery] = useState('');
  const [markedToday, setMarkedToday] = useState<Set<string>>(new Set());

  // Группы, у которых занятие за сегодня уже отмечено.
  useEffect(() => {
    let alive = true;
    supabase
      .from('lessons')
      .select('group_id')
      .eq('lesson_date', today)
      .then(({ data }) => {
        if (alive && data) setMarkedToday(new Set((data as { group_id: string }[]).map((r) => r.group_id)));
      });
    return () => {
      alive = false;
    };
  }, [today]);

  const activeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of enrollments) if (e.status === 'active') m.set(e.group_id, (m.get(e.group_id) ?? 0) + 1);
    return m;
  }, [enrollments]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = groups
      .filter((g) => !g.is_archived)
      .filter((g) => !q || g.name.toLowerCase().includes(q) || (g.teacher?.full_name ?? '').toLowerCase().includes(q))
      .map((g) => {
        const slots = slotsByGroup.get(g.id) ?? [];
        const todaySlot = slots.find((s) => s.weekday === todayWd) ?? null;
        return { g, slots, todaySlot };
      });
    // Сначала группы, у которых занятие сегодня и оно ещё не отмечено; затем остальные по названию.
    const rank = (r: (typeof list)[number]) => (r.todaySlot ? (markedToday.has(r.g.id) ? 1 : 0) : 2);
    return list.sort((a, b) => rank(a) - rank(b) || byName(a.g.name, b.g.name));
  }, [groups, slotsByGroup, query, todayWd, markedToday]);

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить группы: {error}</p>;

  return (
    <div>
      <h1>Посещаемость</h1>
      <div className="filters filters-groups">
        <input
          className="search"
          type="search"
          placeholder="Поиск: название или преподаватель"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="muted count">
        {isAdmin ? 'Групп' : 'Ваших групп'}: {rows.length}
      </p>
      {rows.length === 0 && <p className="muted">Групп не найдено.</p>}

      <div className="group-grid">
        {rows.map(({ g, slots, todaySlot }) => {
          const labels = scheduleLabels(slots);
          return (
            <Link key={g.id} to={`/attendance/${g.id}`} className="group-card">
              <div className="group-card-title">
                {g.name}
                {todaySlot && (
                  <span className={`badge ${markedToday.has(g.id) ? 'badge-done' : 'badge-today'}`}>
                    {markedToday.has(g.id) ? 'сегодня отмечено' : `сегодня ${timeHM(todaySlot.start_time)}`}
                  </span>
                )}
              </div>
              <div className="muted">{g.teacher?.full_name ?? 'преподаватель не указан'}</div>
              <div className="group-card-schedule">
                {labels.length > 0 ? labels.join(' · ') : <span className="muted">расписание не задано</span>}
              </div>
              <div className="group-card-count">{pluralStudents(activeCount.get(g.id) ?? 0)}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
