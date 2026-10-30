import { useMemo, useState } from 'react';
import { ageYears, pluralYears } from '../lib/format';
import type { DirStudent } from '../lib/store';

// Поиск ученика по фамилии (и по любой части ФИО). Фамилии, начинающиеся с введённых букв, идут первыми.
export default function StudentSearch({
  students,
  excludeIds,
  onPick,
  autoFocus,
}: {
  students: DirStudent[];
  excludeIds: Set<string>;
  onPick: (s: DirStudent) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    const found = students.filter((s) => !excludeIds.has(s.id) && s.full_name.toLowerCase().includes(q));
    const rank = (s: DirStudent) => (s.full_name.toLowerCase().startsWith(q) ? 0 : 1);
    return found
      .sort((a, b) => rank(a) - rank(b) || a.full_name.localeCompare(b.full_name, 'ru'))
      .slice(0, 8);
  }, [students, excludeIds, q]);

  return (
    <div>
      <input
        className="search"
        type="search"
        placeholder="Фамилия ученика (от 2 букв)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
      />
      {q.length >= 2 && matches.length === 0 && (
        <p className="muted small">Никого не найдено. Ученики, которые уже выбраны или есть в группе, не показываются.</p>
      )}
      <div className="pick-list">
        {matches.map((s) => {
          const age = ageYears(s.birth_date);
          return (
            <button
              type="button"
              key={s.id}
              className="pick-item"
              onClick={() => {
                onPick(s);
                setQuery('');
              }}
            >
              <span>{s.full_name}</span>
              <span className="muted">{age !== null ? pluralYears(age) : 'возраст не указан'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
