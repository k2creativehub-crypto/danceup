import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import StudentSearch from '../components/StudentSearch';
import { ageYears, pluralStudents, pluralYears, scheduleLabels, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';
import type { DirStudent } from '../lib/store';

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

interface Picked {
  student: DirStudent;
  isPrimary: boolean;
}

function CreateGroup({ defaultSeason, onCancel }: { defaultSeason: string; onCancel: () => void }) {
  const navigate = useNavigate();
  const dir = useDirectory();
  const [name, setName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [season, setSeason] = useState(defaultSeason);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Если группа уже создана, а ученики не добавились, повторное нажатие добавляет только учеников.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.student.id)), [picked]);

  const addStudent = (s: DirStudent) => {
    // Если ученик уже занимается где-то в основной группе, новая для него по умолчанию дополнительная.
    const hasPrimary = (dir.enrollmentsByStudent.get(s.id) ?? []).some((e) => e.status === 'active' && e.is_primary);
    setPicked((list) => [...list, { student: s, isPrimary: !hasPrimary }]);
  };

  const submit = async () => {
    if (!createdId) {
      if (!name.trim()) return setErr('Укажите название группы');
      if (!teacherId) return setErr('Выберите преподавателя');
      if (!season.trim()) return setErr('Укажите сезон');
    }
    setBusy(true);
    setErr(null);

    let groupId = createdId;
    const groupSeason = season.trim();
    if (!groupId) {
      groupId = crypto.randomUUID();
      const { error } = await supabase
        .from('groups')
        .insert({ id: groupId, name: name.trim(), teacher_id: teacherId, season: groupSeason });
      if (error) {
        setBusy(false);
        return setErr(error.message);
      }
      setCreatedId(groupId);
    }

    if (picked.length > 0) {
      const start = todayMinsk();
      const { error } = await supabase.from('enrollments').insert(
        picked.map((p) => ({
          id: crypto.randomUUID(),
          student_id: p.student.id,
          group_id: groupId,
          season: groupSeason,
          is_primary: p.isPrimary,
          status: 'active',
          start_date: start,
        })),
      );
      if (error) {
        setBusy(false);
        await dir.refresh(['groups']);
        return setErr(`Группа создана, но добавить учеников не удалось: ${error.message}`);
      }
    }

    await dir.refresh(['groups', 'enrollments']);
    setBusy(false);
    navigate(`/groups/${groupId}`);
  };

  return (
    <div className="panel">
      <h2>Новая группа</h2>
      <label className="field">
        <span>Название</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!createdId} autoFocus />
      </label>
      <label className="field">
        <span>Преподаватель</span>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={!!createdId}>
          <option value="">— выберите —</option>
          {dir.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Сезон</span>
        <input value={season} onChange={(e) => setSeason(e.target.value)} disabled={!!createdId} />
      </label>

      <div className="create-students">
        <div className="create-students-head">
          <strong>Ученики{picked.length > 0 ? ` · ${picked.length}` : ''}</strong>
          {!searching && (
            <button type="button" className="btn btn-sm" onClick={() => setSearching(true)}>
              + Добавить учеников
            </button>
          )}
        </div>

        {picked.length > 0 && (
          <div className="picked-list">
            {picked.map((p) => {
              const age = ageYears(p.student.birth_date);
              return (
                <div key={p.student.id} className="picked-item">
                  <div className="picked-name">
                    {p.student.full_name}
                    {age !== null && <span className="muted"> · {pluralYears(age)}</span>}
                  </div>
                  <select
                    value={p.isPrimary ? 'true' : 'false'}
                    onChange={(e) =>
                      setPicked((list) =>
                        list.map((x) =>
                          x.student.id === p.student.id ? { ...x, isPrimary: e.target.value === 'true' } : x,
                        ),
                      )
                    }
                  >
                    <option value="true">Основная</option>
                    <option value="false">Дополнительная</option>
                  </select>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Убрать из списка"
                    aria-label="Убрать из списка"
                    onClick={() => setPicked((list) => list.filter((x) => x.student.id !== p.student.id))}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {searching && (
          <div className="create-search">
            <StudentSearch students={dir.students} excludeIds={pickedIds} onPick={addStudent} autoFocus />
            <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setSearching(false)}>
              Готово
            </button>
          </div>
        )}
      </div>

      <p className="muted small">Расписание и цену группы задаём позже, в разделе «Цены и расписание».</p>
      {err && <p className="error">{err}</p>}
      {createdId && (
        <p className="small">
          <Link to={`/groups/${createdId}`}>Открыть созданную группу</Link>
        </p>
      )}
      <div className="field-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {busy ? 'Создаём…' : createdId ? 'Добавить учеников' : 'Создать'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          {createdId ? 'Закрыть' : 'Отмена'}
        </button>
      </div>
    </div>
  );
}

export default function Groups() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { groups, enrollments, slotsByGroup, loading, error } = useDirectory();

  const [query, setQuery] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const countsByGroup = useMemo(() => {
    const m = new Map<string, { active: number; reserve: number }>();
    for (const e of enrollments) {
      const c = m.get(e.group_id) ?? { active: 0, reserve: 0 };
      if (e.status === 'active') c.active += 1;
      if (e.status === 'reserve') c.reserve += 1;
      m.set(e.group_id, c);
    }
    return m;
  }, [enrollments]);

  // Сезон для новой группы берём самый частый среди существующих, чтобы не угадывать формат.
  const defaultSeason = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const g of groups) if (g.season) cnt.set(g.season, (cnt.get(g.season) ?? 0) + 1);
    let best = '';
    let max = 0;
    for (const [k, v] of cnt) {
      if (v > max) {
        best = k;
        max = v;
      }
    }
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

      {creating && <CreateGroup defaultSeason={defaultSeason} onCancel={() => setCreating(false)} />}

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
