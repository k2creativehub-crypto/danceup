import { useEffect, useMemo, useState } from 'react';
import { fetchBalances } from '../../lib/billing';
import type { BalanceRow } from '../../lib/billing';
import { formatByn } from '../../lib/money';
import { useDirectory } from '../../lib/store';

export default function BalanceTab({
  ym, onPay, onInvoice,
}: { ym: string; onPay: (studentId: string) => void; onInvoice: (studentId: string) => void }) {
  const dir = useDirectory();
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    fetchBalances(ym).then((r) => alive && setRows(r)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [ym]);

  // Группы ученика (активные зачисления).
  const groupsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of dir.enrollments) {
      if (e.status !== 'active') continue;
      const g = dir.groupById.get(e.group_id);
      if (!g) continue;
      m.set(e.student_id, [...(m.get(e.student_id) ?? []), g.name]);
    }
    return m;
  }, [dir.enrollments, dir.groupById]);

  const view = useMemo(() => {
    if (!rows) return [];
    const s = q.trim().toLowerCase();
    const inGroup = groupId
      ? new Set(dir.enrollments.filter((e) => e.group_id === groupId && e.status === 'active').map((e) => e.student_id))
      : null;
    const list = rows
      .map((r) => ({ r, name: dir.studentById.get(r.student_id)?.full_name ?? 'Ученик' }))
      .filter((x) => !s || x.name.toLowerCase().includes(s))
      .filter((x) => !inGroup || inGroup.has(x.r.student_id))
      .filter((x) => !debtOnly || x.r.debt_kopecks > 0);
    // Сверху должники (больший долг выше), затем остальные по алфавиту.
    return list.sort((a, b) => {
      const da = a.r.debt_kopecks > 0, db = b.r.debt_kopecks > 0;
      if (da !== db) return da ? -1 : 1;
      if (da && db && a.r.debt_kopecks !== b.r.debt_kopecks) return b.r.debt_kopecks - a.r.debt_kopecks;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [rows, q, groupId, debtOnly, dir.studentById, dir.enrollments]);

  if (error) return <p className="error">Не удалось загрузить баланс: {error}</p>;
  if (!rows) return <p className="muted">Загрузка…</p>;

  return (
    <div>
      <div className="bill-filters">
        <input className="search" type="search" placeholder="Поиск по фамилии" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Все группы</option>
          {dir.groups.filter((g) => !g.is_archived).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <label className="bill-check">
          <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} /> Только с долгом
        </label>
      </div>
      <p className="muted count">Учеников: {view.length}</p>
      <div className="bill-scroll">
        <table className="bill-table">
          <thead>
            <tr><th>ФИО</th><th>Группы</th><th className="num">Начислено</th><th className="num">Оплачено</th><th className="num">Долг / переплата</th><th /></tr>
          </thead>
          <tbody>
            {view.map(({ r, name }) => (
              <tr key={r.student_id}>
                <td>{name}</td>
                <td className="muted">{(groupsOf.get(r.student_id) ?? []).join(', ') || '—'}</td>
                <td className="num">{formatByn(r.charged_kopecks)}</td>
                <td className="num">{formatByn(r.paid_kopecks)}</td>
                <td className={`num ${r.debt_kopecks > 0 ? 'debt' : r.debt_kopecks < 0 ? 'overpay' : ''}`}>
                  {r.debt_kopecks > 0 ? `долг ${formatByn(r.debt_kopecks)}` : r.debt_kopecks < 0 ? `переплата ${formatByn(-r.debt_kopecks)}` : '—'}
                </td>
                <td className="bill-actions">
                  <button className="btn" onClick={() => onPay(r.student_id)}>Оплата</button>
                  <button className="btn" onClick={() => onInvoice(r.student_id)}>Счёт</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="muted">Никого не найдено.</p>}
    </div>
  );
}
