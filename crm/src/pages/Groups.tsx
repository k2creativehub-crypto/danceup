import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { pluralStudents, scheduleLabels } from '../lib/format';
import type { ScheduleSlot } from '../lib/format';

interface GroupItem {
  id: string;
  name: string;
  season: string;
  teacher_id: string | null;
  is_archived: boolean;
  teacher: { full_name: string } | null;
}
interface EnrCount {
  group_id: string;
  status: 'active' | 'reserve' | 'left';
}
interface TeacherItem {
  id: string;
  full_name: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

function CreateGroup({
  teachers,
  defaultSeason,
  onCancel,
}: {
  teachers: TeacherItem[];
  defaultSeason: string;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [season, setSeason] = useState(defaultSeason);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setErr('Укажите название группы');
    if (!teacherId) return setErr('Выберите преподавателя');
    if (!season.trim()) return setErr('Укажите сезон');
    setBusy(true);
    setErr(null);
    const id = crypto.randomUUID();
    const { error } = await supabase
      .from('groups')
      .insert({ id, name: name.trim(), teacher_id: teacherId, season: season.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    navigate(`/groups/${id}`);
  };

  return (
    <div className="panel">
      <h2>Новая группа</h2>
      <label className="field">
        <span>Название</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Преподаватель</span>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">— выберите —</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Сезон</span>
        <input value={season} onChange={(e) => setSeason(e.target.value)} />
      </label>
      <p className="muted small">Расписание и цену группы задаём позже, в разделе «Цены и расписание».</p>
      {err && <p className="error">{err}</p>}
      <div className="field-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {busy ? 'Создаём…' : 'Создать'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function Groups() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [enr, setEnr] = useState<EnrCount[]>([]);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [gr, sc, en, te] = await Promise.all([
        supabase
          .from('groups')
          .select('id, name, season, teacher_id, is_archived, teacher:teachers(full_name)')
          .limit(1000),
        supabase.from('group_schedule').select('group_id, weekday, start_time, end_time, location').limit(5000),
        supabase.from('enrollments_v').select('group_id, status').limit(10000),
        isAdmin
          ? supabase.from('teachers').select('id, full_name').limit(500)
          : Promise.resolve({ data: [] as TeacherItem[], error: null }),
      ]);
      if (cancelled) return;
      const firstError = gr.error ?? sc.error ?? en.error ?? te.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setGroups((gr.data ?? []) as unknown as GroupItem[]);
        setSlots((sc.data ?? []) as unknown as ScheduleSlot[]);
        setEnr((en.data ?? []) as unknown as EnrCount[]);
        setTeachers(((te.data ?? []) as TeacherItem[]).sort((a, b) => byName(a.full_name, b.full_name)));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const slotsByGroup = useMemo(() => {
    const m = new Map<string, ScheduleSlot[]>();
    for (const s of slots) m.set(s.group_id, [...(m.get(s.group_id) ?? []), s]);
    return m;
  }, [slots]);

  const countsByGroup = useMemo(() => {
    const m = new Map<string, { active: number; reserve: number }>();
    for (const e of enr) {
      const c = m.get(e.group_id) ?? { active: 0, reserve: 0 };
      if (e.status === 'active') c.active += 1;
      if (e.status === 'reserve') c.reserve += 1;
      m.set(e.group_id, c);
    }
    return m;
  }, [enr]);

  // Сезон для новой группы берём самый частый среди существующих, чтобы не угадывать формат.
  const defaultSeason = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const g of groups) if (g.season) cnt.set(g.season, (cnt.get(g.season) ?? 0) + 1);
    let best = '';
    let max = 0;
    for (const [k, v] of cnt) if (v > max) { best = k; max = v; }
    return best;
  }, [groups]);

  const teacherOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.teacher_id && g.teacher) m.set(g.teacher_id, g.teacher.full_name);
    return [...m.entries()].sort((a, b) => byName(a[1], b[1]));
  }, [groups]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => (showArchived ? true : !g.is_archived))
      .filter((g) => !teacherId || g.teacher_id === teacherId)
      .filter((g) => !q || g.name.toLowerCase().includes(q) || (g.teacher?.full_name ?? '').toLowerCase().includes(q))
      .sort((a, b) => byName(a.name, b.name));
  }, [groups, query, teacherId, showArchived]);

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить группы: {error}</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Группы</h1>
        {isAdmin && !creating && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + Создать группу
          </button>
        )}
      </div>

      {creating && (
        <CreateGroup teachers={teachers} defaultSeason={defaultSeason} onCancel={() => setCreating(false)} />
      )}

      <div className="filters filters-groups">
        <input
          className="search"
          type="search"
          placeholder="Поиск: название или преподаватель"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {isAdmin && (
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Все преподаватели</option>
            {teacherOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показать архивные
        </label>
      </div>

      <p className="muted count">Групп: {rows.length}</p>

      {rows.length === 0 && <p className="muted">Групп не найдено.</p>}

      <div className="group-grid">
        {rows.map((g) => {
          const labels = scheduleLabels(slotsByGroup.get(g.id) ?? []);
          const c = countsByGroup.get(g.id) ?? { active: 0, reserve: 0 };
          return (
            <Link key={g.id} to={`/groups/${g.id}`} className={`group-card${g.is_archived ? ' is-archived' : ''}`}>
              <div className="group-card-title">
                {g.name}
                {g.is_archived && <span className="badge">архив</span>}
              </div>
              <div className="muted">{g.teacher?.full_name ?? 'преподаватель не указан'}</div>
              <div className="group-card-schedule">
                {labels.length > 0 ? labels.join(' · ') : <span className="muted">расписание не задано</span>}
              </div>
              <div className="group-card-count">
                {pluralStudents(c.active)}
                {c.reserve > 0 && <span className="muted"> · резерв {c.reserve}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
