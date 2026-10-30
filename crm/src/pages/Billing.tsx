import { useState } from 'react';
import { formatMonth, monthOf, shiftMonth } from '../lib/dates';
import { todayMinsk } from '../lib/format';
import BalanceTab from './billing/BalanceTab';
import PaymentTab from './billing/PaymentTab';
import ChildInvoiceTab from './billing/ChildInvoiceTab';
import GroupInvoicesTab from './billing/GroupInvoicesTab';

type Tab = 'balance' | 'payment' | 'child' | 'group';
const TABS: { id: Tab; label: string }[] = [
  { id: 'balance', label: 'Баланс' },
  { id: 'payment', label: 'Оплата' },
  { id: 'child', label: 'Счёт ребёнка' },
  { id: 'group', label: 'Счета группы' },
];

export default function Billing() {
  const [tab, setTab] = useState<Tab>('balance');
  const [ym, setYm] = useState(monthOf(todayMinsk()));
  const [studentId, setStudentId] = useState<string | null>(null);

  return (
    <div className="billing-page">
      <h1>Оплаты и счета</h1>
      <div className="bill-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`bill-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab !== 'payment' && (
        <div className="bill-month">
          <button className="btn btn-ghost" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Предыдущий месяц">‹</button>
          <strong>{formatMonth(ym)}</strong>
          <button className="btn btn-ghost" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Следующий месяц">›</button>
        </div>
      )}
      {tab === 'balance' && (
        <BalanceTab ym={ym}
          onPay={(id) => { setStudentId(id); setTab('payment'); }}
          onInvoice={(id) => { setStudentId(id); setTab('child'); }} />
      )}
      {tab === 'payment' && <PaymentTab studentId={studentId} setStudentId={setStudentId} />}
      {tab === 'child' && <ChildInvoiceTab ym={ym} studentId={studentId} setStudentId={setStudentId} />}
      {tab === 'group' && <GroupInvoicesTab ym={ym} />}
    </div>
  );
}
