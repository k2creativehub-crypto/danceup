import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { pluralStudents, scheduleLabels } from '../lib/format';
import { useDirectory } from '../lib/store';

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

function pluralGroups(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'группа' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'группы' : 'групп';
  return `${n} ${word}`;
}

// Раздел «Преподаватели» (только админ): список, а в карточке преподавателя его группы.
export default function Teachers() {
  const { id } = useParams();
  return id ? <TeacherCard id={id} /> : <TeacherList />;
}

function TeacherList() {
  const dir = useDirectory();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...dir.teachers]
      .filter((t) => !q || t.full_name.toLowerCase().includes(q))
      .sort((a, b) => byName(a.full_name, b.full_name))
      .map((t) => ({
        t,
        count: dir.groups.filter((g) => g.teacher_id === t.id && !g.is_archived).length,
      }));
  }, [dir.teachers, dir.groups, query]);

  return (
    <div>
      <h1>Преподаватели</h1>
      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Поиск по ФИО"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="muted count">Преподавателей: {rows.length}</p>
      {dir.loading && rows.length === 0 && <p className="muted">Загрузка…</p>}
      {!dir.loading && rows.length === 0 && <p className="muted">Преподавателей не найдено.</p>}
      <div className="group-grid">
        {rows.map(({ t, count }) => (
          <Link key={t.id} to={`/teachers/${t.id}`} className="group-card">
            <div className="group-card-title">{t.full_name}</div>
            <div className="muted">{count > 0 ? pluralGroups(count) : 'нет действующих групп'}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function TeacherCard({ id }: { id: string }) {
  const dir = useDirectory();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);

  const teacher = dir.teachers.find((t) => t.id === id);
  const all = useMemo(
    () => dir.groups.filter((g) => g.teacher_id === id).sort((a, b) => byName(a.name, b.name)),
    [dir.groups, id],
  );
  const archivedCount = all.filter((g) => g.is_archived).length;
  const groups = showArchived ? all : all.filter((g) => !g.is_archived);

  const back = (
    <button type="button" className="btn btn-sm back-btn" onClick={() => navigate('/teachers')}>
      ← Все преподаватели
    </button>
  );

  if (!teacher) {
    return (
      <div>
        {back}
        {dir.loading ? <p className="muted">Загрузка…</p> : <p className="muted">Преподаватель не найден.</p>}
      </div>
    );
  }

  return (
    <div>
      {back}
      <h1>{teacher.full_name}</h1>
      <p className="muted count">
        Групп: {groups.length}
        {archivedCount > 0 && !showArchived ? ` (архивных скрыто: ${archivedCount})` : ''}
      </p>
      {archivedCount > 0 && (
        <label className="check" style={{ marginBottom: 12, display: 'inline-flex' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показать архивные
        </label>
      )}
      {groups.length === 0 && <p className="muted">У преподавателя нет групп.</p>}
      <div className="group-grid">
        {groups.map((g) => {
          const labels = scheduleLabels(dir.slotsByGroup.get(g.id) ?? []);
          const list = dir.enrollmentsByGroup.get(g.id) ?? [];
          const active = list.filter((e) => e.status === 'active').length;
          const reserve = list.filter((e) => e.status === 'reserve').length;
          return (
            <Link key={g.id} to={`/groups/${g.id}`} className={`group-card${g.is_archived ? ' is-archived' : ''}`}>
              <div className="group-card-title">
                {g.name}
                {g.is_archived && <span className="badge">архив</span>}
              </div>
              <div className="group-card-schedule">
                {labels.length > 0 ? labels.join(' · ') : <span className="muted">расписание не задано</span>}
              </div>
              <div className="group-card-count">
                {pluralStudents(active)}
                {reserve > 0 && <span className="muted"> · резерв {reserve}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
