import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PencilIcon } from '../components/Icons';
import { useAuth } from '../auth';
import { ageYears, digits, formatPhone, pluralYears } from '../lib/format';
import { useDirectory } from '../lib/store';
import type { DirEnrollment } from '../lib/store';
import StudentCard from './StudentCard';

type Enrollment = DirEnrollment;

const FILTER_KEY = 'crm-filters';

interface SavedFilters {
  query: string;
  groupId: string;
  teacherName: string;
  status: string;
}

// Фильтры запоминаются на время сессии, чтобы после возврата из карточки список не сбрасывался.
function loadFilters(): SavedFilters {
  const empty: SavedFilters = { query: '', groupId: '', teacherName: '', status: 'all' };
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {
    /* хранилище недоступно, начинаем с пустых фильтров */
  }
  return empty;
}

const STATUS_LABEL: Record<Enrollment['status'], string> = {
  active: 'занимается',
  reserve: 'резерв',
  left: 'выбыл',
};

export default function Crm() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const { id: selectedId } = useParams();
  const { students, groups, groupById, enrollmentsByStudent, loading, error } = useDirectory();

  const [initial] = useState(loadFilters);
  const [query, setQuery] = useState(initial.query);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [teacherName, setTeacherName] = useState(initial.teacherName);
  const [status, setStatus] = useState<'all' | Enrollment['status']>(initial.status as 'all' | Enrollment['status']);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, groupId, teacherName, status }));
    } catch {
      /* ничего страшного, фильтры просто не запомнятся */
    }
  }, [query, groupId, teacherName, status]);

  const groupOptions = useMemo(
    () =>
      [...groups]
        .map((g) => ({ id: g.id, label: `${g.name} — ${g.teacher?.full_name ?? '?'}` }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [groups],
  );

  const teacherOptions = useMemo(
    () =>
      Array.from(new Set(groups.map((g) => g.teacher?.full_name).filter((x): x is string => !!x))).sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    [groups],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digits(query);
    return students
      .filter((s) => {
        const enr = enrollmentsByStudent.get(s.id) ?? [];
        if (groupId && !enr.some((e) => e.group_id === groupId)) return false;
        if (teacherName && !enr.some((e) => groupById.get(e.group_id)?.teacher?.full_name === teacherName)) {
          return false;
        }
        if (status !== 'all' && !enr.some((e) => e.status === status)) return false;
        if (q) {
          const inName = s.full_name.toLowerCase().includes(q);
          const phones = [s.phone, s.guardian?.phone].filter(Boolean).join(' ');
          const guardianName = (s.guardian?.full_name ?? '').toLowerCase();
          const inPhone = qDigits.length >= 3 && digits(phones).includes(qDigits);
          if (!inName && !inPhone && !guardianName.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
  }, [students, enrollmentsByStudent, groupById, query, groupId, teacherName, status]);

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить данные: {error}</p>;

  let lastLetter = '';

  return (
    <div className={`split${selectedId ? ' has-card' : ''}`}>
      <div className="split-list">
      <h1>CRM</h1>

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Поиск: ФИО, родитель, телефон"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Все группы</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select value={teacherName} onChange={(e) => setTeacherName(e.target.value)}>
            <option value="">Все преподаватели</option>
            {teacherOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">Любой статус</option>
          <option value="active">Занимаются</option>
          <option value="reserve">Резерв</option>
          <option value="left">Выбыли</option>
        </select>
      </div>

      <p className="muted count">Найдено: {rows.length}</p>

      <div className="list">
        <div className="row row-head">
          <div>Ученик</div>
          <div>Возраст</div>
          <div>Группы</div>
          <div>Контакт</div>
          <div></div>
        </div>

        {rows.length === 0 && <p className="muted">Никого не найдено.</p>}

        {rows.map((s) => {
          const letter = (s.full_name.trim()[0] ?? '#').toUpperCase();
          const showLetter = letter !== lastLetter;
          lastLetter = letter;

          const age = ageYears(s.birth_date);
          const enr = [...(enrollmentsByStudent.get(s.id) ?? [])].sort(
            (a, b) => Number(b.is_primary) - Number(a.is_primary),
          );
          const phone = s.phone ?? s.guardian?.phone ?? null;
          const contactName = s.phone ? 'сам(а)' : s.guardian?.full_name ?? null;

          return (
            <div key={s.id}>
              {showLetter && <div className="letter">{letter}</div>}
              <div className={`row${s.id === selectedId ? ' is-selected' : ''}`}>
                <div className="cell-name">{s.full_name}</div>
                <div className="cell-age muted">
                  {age !== null ? pluralYears(age) : s.birth_date_raw ? s.birth_date_raw : '—'}
                </div>
                <div className="cell-groups">
                  {enr.length === 0 && <span className="muted">—</span>}
                  {enr.map((e) => {
                    const g = groupById.get(e.group_id);
                    if (!g) return null;
                    return (
                      <span
                        key={e.group_id}
                        className={`chip chip-${e.status}${e.is_primary ? '' : ' chip-extra'}`}
                        title={`${g.teacher?.full_name ?? ''} · ${STATUS_LABEL[e.status]}`}
                      >
                        {g.name}
                        <small>{g.teacher?.full_name?.split(' ')[0] ?? ''}</small>
                        {e.status !== 'active' && <em>{STATUS_LABEL[e.status]}</em>}
                      </span>
                    );
                  })}
                </div>
                <div className="cell-contact">
                  {phone ? <a href={`tel:${phone}`}>{formatPhone(phone)}</a> : <span className="muted">нет телефона</span>}
                  {contactName && <small className="muted">{contactName}</small>}
                </div>
                <div className="cell-open">
                  <Link className="btn btn-sm" to={`/students/${s.id}`} title="Открыть карточку">
                    <PencilIcon size={16} /> Открыть
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      {selectedId && (
        <div className="split-card">
          <StudentCard key={selectedId} />
        </div>
      )}
    </div>
  );
}
