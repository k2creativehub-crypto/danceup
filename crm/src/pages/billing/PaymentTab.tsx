import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { fetchPayments } from '../../lib/billing';
import type { Payment } from '../../lib/billing';
import { formatByn, parseBynToKopecks } from '../../lib/money';
import { formatLong } from '../../lib/dates';
import { todayMinsk } from '../../lib/format';
import StudentPicker from './StudentPicker';

export default function PaymentTab({ studentId, setStudentId }: { studentId: string | null; setStudentId: (id: string | null) => void }) {
  const [date, setDate] = useState(todayMinsk());
  const [amount, setAmount] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studentId) return setPayments([]);
    try {
      setPayments(await fetchPayments(studentId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const submit = async () => {
    const kop = parseBynToKopecks(amount);
    if (!studentId) return setError('Выберите ученика');
    if (!kop) return setError('Введите сумму в BYN, например 120 или 85,50');
    if (!date) return setError('Укажите дату');
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from('payments').insert({ student_id: studentId, paid_on: date, amount_kopecks: kop });
    setBusy(false);
    if (e) return setError(e.message);
    setAmount('');
    setFlash(`Внесено: ${formatByn(kop)}`);
    await load();
  };

  const remove = async (p: Payment) => {
    if (!window.confirm(`Удалить оплату ${formatByn(p.amount_kopecks)} от ${formatLong(p.paid_on)}? Это нельзя отменить.`)) return;
    setError(null);
    const { error: e, count } = await supabase.from('payments').delete({ count: 'exact' }).eq('id', p.id);
    if (e) return setError(e.message);
    if (count === 0) return setError('Не удалось удалить: нет прав (удалять может только админ).');
    await load();
  };

  return (
    <div className="bill-pay">
      <StudentPicker value={studentId} onChange={setStudentId} />
      <div className="bill-form">
        <label>Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Сумма, BYN<input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()} /></label>
        <button className="btn btn-primary" disabled={busy || !studentId} onClick={() => void submit()}>Внести</button>
      </div>
      {error && <p className="error">{error}</p>}
      {flash && <p className="flash">{flash}</p>}

      {studentId && (
        <>
          <h3>История оплат</h3>
          {payments.length === 0 && <p className="muted">Оплат пока нет.</p>}
          <ul className="bill-history">
            {payments.map((p) => (
              <li key={p.id}>
                <span>{formatLong(p.paid_on)} {p.paid_on.slice(0, 4)}</span>
                <strong>{formatByn(p.amount_kopecks)}</strong>
                <button className="btn btn-ghost" onClick={() => void remove(p)}>Удалить</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
