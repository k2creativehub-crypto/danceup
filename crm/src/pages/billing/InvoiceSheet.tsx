import { createPortal } from 'react-dom';
import { SCHOOL } from '../../lib/school';
import { formatMonth } from '../../lib/dates';
import { formatByn } from '../../lib/money';

export interface InvoiceRowView {
  groupName: string;
  teacher: string;
  lessons: number;
  amount: number; // копейки
  noPrice: number;
}
export interface InvoiceView {
  studentName: string;
  ageLabel: string | null;
  ym: string;
  rows: InvoiceRowView[];
}

export function invoiceTotal(v: InvoiceView): number {
  return v.rows.reduce((s, r) => s + r.amount, 0);
}

// Печатная форма. Долг и оплаты сюда не попадают.
export function InvoiceSheet({ v }: { v: InvoiceView }) {
  const requisites = [
    SCHOOL.unp && `УНП ${SCHOOL.unp}`,
    SCHOOL.account && `р/с ${SCHOOL.account}`,
    SCHOOL.bank,
    SCHOOL.address,
    SCHOOL.phone,
    SCHOOL.email,
  ].filter(Boolean);

  return (
    <section className="invoice-sheet">
      {SCHOOL.name && <div className="invoice-org">{SCHOOL.name}</div>}
      {requisites.length > 0 && <div className="invoice-req">{requisites.join(' · ')}</div>}
      <h2 className="invoice-title">Счёт за {formatMonth(v.ym).toLowerCase()}</h2>
      <p className="invoice-student">
        <strong>{v.studentName}</strong>
        {v.ageLabel && <span>, {v.ageLabel}</span>}
      </p>
      <table className="invoice-table">
        <thead>
          <tr><th>Группа</th><th>Преподаватель</th><th className="num">Занятий</th><th className="num">Сумма</th></tr>
        </thead>
        <tbody>
          {v.rows.map((r, i) => (
            <tr key={i}>
              <td>{r.groupName}</td>
              <td>{r.teacher}</td>
              <td className="num">{r.lessons}</td>
              <td className="num">{formatByn(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}>К оплате</td><td className="num">{formatByn(invoiceTotal(v))}</td></tr>
        </tfoot>
      </table>
    </section>
  );
}

// Копия счетов в #print-root: при печати виден только он (см. styles.css).
export function PrintPortal({ children }: { children: React.ReactNode }) {
  let host = document.getElementById('print-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'print-root';
    document.body.appendChild(host);
  }
  return createPortal(children, host);
}
