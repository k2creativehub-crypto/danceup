import { useEffect, useMemo, useState } from 'react';
import { fetchBalances, fetchInvoiceLines, fetchPayments, printNow } from '../../lib/billing';
import type { BalanceRow, InvoiceLine, Payment } from '../../lib/billing';
import { formatByn } from '../../lib/money';
import { monthBounds } from '../../lib/dates';
import { useDirectory } from '../../lib/store';
import StudentPicker from './StudentPicker';
import { InvoiceSheet, PrintPortal, invoiceTotal } from './InvoiceSheet';
import { buildInvoice } from './invoiceData';

export default function ChildInvoiceTab({ ym, studentId, setStudentId }: { ym: string; studentId: string | null; setStudentId: (id: string | null) => void }) {
  const dir = useDirectory();
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);
  const [balance, setBalance] = useState<BalanceRow | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    setLines(null);
    setError(null);
    Promise.all([fetchInvoiceLines(ym, null), fetchBalances(ym), fetchPayments(studentId)])
      .then(([l, b, p]) => {
        if (!alive) return;
        setLines(l);
        setBalance(b.find((x) => x.student_id === studentId) ?? null);
        setPayments(p);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [ym, studentId]);

  const view = useMemo(() => (studentId && lines ? buildInvoice(dir, studentId, ym, lines) : null), [dir, studentId, ym, lines]);
  const { from, to } = monthBounds(ym);
  const monthPaid = payments.filter((p) => p.paid_on >= from && p.paid_on <= to).reduce((s, p) => s + p.amount_kopecks, 0);
  const noPrice = view ? view.rows.reduce((s, r) => s + r.noPrice, 0) : 0;

  return (
    <div>
      <StudentPicker value={studentId} onChange={setStudentId} />
      {error && <p className="error">{error}</p>}
      {studentId && !view && !error && <p className="muted">Загрузка…</p>}
      {view && (
        <>
          {noPrice > 0 && <p className="bill-warn">занятий без цены: {noPrice}</p>}
          {view.rows.length === 0 && <p className="muted">За этот месяц платных занятий нет.</p>}
          <InvoiceSheet v={view} />
          <PrintPortal><InvoiceSheet v={view} /></PrintPortal>
          <div className="bill-onscreen">
            <div>Начислено за месяц: <strong>{formatByn(invoiceTotal(view))}</strong></div>
            <div>Оплачено в этом месяце: <strong>{formatByn(monthPaid)}</strong></div>
            {balance && (
              <div>
                На конец месяца:{' '}
                <strong className={balance.debt_kopecks > 0 ? 'debt' : 'overpay'}>
                  {balance.debt_kopecks > 0 ? `долг ${formatByn(balance.debt_kopecks)}` : balance.debt_kopecks < 0 ? `переплата ${formatByn(-balance.debt_kopecks)}` : 'нет долга'}
                </strong>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={printNow}>Печать / PDF</button>
        </>
      )}
    </div>
  );
}
