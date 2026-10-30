import { useMemo, useState } from 'react';
import { useDirectory } from '../../lib/store';

// Поиск ученика по фамилии. Если в проекте уже есть такой компонент (из «Добавить в группу»), можно заменить им.
export default function StudentPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const dir = useDirectory();
  const [q, setQ] = useState('');
  const students = useMemo(
    () => Array.from(dir.studentById.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')),
    [dir.studentById],
  );
  const selected = value ? dir.studentById.get(value) : null;
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return students.filter((x) => x.full_name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, students]);

  if (selected) {
    return (
      <div className="bill-picked">
        <strong>{selected.full_name}</strong>
        <button className="btn btn-ghost" onClick={() => { onChange(null); setQ(''); }}>Сменить</button>
      </div>
    );
  }
  return (
    <div className="bill-picker">
      <input className="search" type="search" placeholder="Фамилия ученика" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <ul className="bill-picker-list">
          {found.map((s) => (
            <li key={s.id}><button onClick={() => onChange(s.id)}>{s.full_name}</button></li>
          ))}
        </ul>
      )}
      {q.trim() && found.length === 0 && <p className="muted">Не найдено.</p>}
    </div>
  );
}
