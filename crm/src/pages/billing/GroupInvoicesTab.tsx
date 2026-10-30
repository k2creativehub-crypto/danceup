import { useEffect, useMemo, useState } from 'react';
import { fetchInvoiceLines, fetchMarkedStudents, printNow } from '../../lib/billing';
import type { InvoiceLine } from '../../lib/billing';
import { formatByn } from '../../lib/money';
import { datesInMonth } from '../../lib/dates';
import { enrolledOn } from '../../lib/attendance';
import { useDirectory } from '../../lib/store';
import { InvoiceSheet, PrintPortal, invoiceTotal } from './InvoiceSheet';
import { buildInvoice } from './invoiceData';

export default function GroupInvoicesTab({ ym }: { ym: string }) {
  const dir = useDirectory();
  const [groupId, setGroupId] = useState('');
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setLines(null);
    setError(null);
    Promise.all([fetchInvoiceLines(ym, groupId), fetchMarkedStudents(groupId, ym)])
      .then(([l, m]) => { if (alive) { setLines(l); setMarked(m); } })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [ym, groupId]);

  const items = useMemo(() => {
    if (!groupId || !lines) return [];
    const days = datesInMonth(ym);
    const ids = new Set<string>(lines.map((l) => l.student_id));
    for (const e of dir.enrollmentsByGroup.get(groupId) ?? []) if (days.some((d) => enrolledOn(e, d))) ids.add(e.student_id);
    return [...ids]
      .map((id) => {
        const v = buildInvoice(dir, id, ym, lines);
        return { id, v, noPrice: v.rows.reduce((s, r) => s + r.noPrice, 0), noMarks: !marked.has(id) };
      })
      .sort((a, b) => a.v.studentName.localeCompare(b.v.studentName, 'ru'));
  }, [dir, groupId, lines, marked, ym]);

  const noPriceList = items.filter((i) => i.noPrice > 0);
  const noMarksList = items.filter((i) => i.noMarks);
  const printable = items.filter((i) => i.v.rows.length > 0);

  return (
    <div>
      <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        <option value="">Выберите группу</option>
        {dir.groups.filter((g) => !g.is_archived).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {error && <p className="error">{error}</p>}
      {groupId && !lines && !error && <p className="muted">Загрузка…</p>}
      {lines && (
        <>
          {(noPriceList.length > 0 || noMarksList.length > 0) && (
            <div className="bill-problems">
              <strong>Перед печатью проверьте:</strong>
              {noPriceList.length > 0 && <p className="bill-warn">Нет цены: {noPriceList.map((i) => `${i.v.studentName} (${i.noPrice})`).join(', ')}</p>}
              {noMarksList.length > 0 && <p className="bill-warn">Нет ни одной отметки за месяц: {noMarksList.map((i) => i.v.studentName).join(', ')}</p>}
            </div>
          )}
          <table className="bill-table">
            <thead><tr><th>ФИО</th><th className="num">Занятий</th><th className="num">Сумма</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.v.studentName}{i.noPrice > 0 && <span className="bill-warn"> · без цены: {i.noPrice}</span>}{i.noMarks && <span className="bill-warn"> · нет отметок</span>}</td>
                  <td className="num">{i.v.rows.reduce((s, r) => s + r.lessons, 0)}</td>
                  <td className="num">{formatByn(invoiceTotal(i.v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <p className="muted">В группе нет учеников за этот месяц.</p>}
          <button className="btn btn-primary" disabled={printable.length === 0} onClick={printNow}>
            Печать всех счетов ({printable.length})
          </button>
          <PrintPortal>{printable.map((i) => <InvoiceSheet key={i.id} v={i.v} />)}</PrintPortal>
        </>
      )}
    </div>
  );
}
