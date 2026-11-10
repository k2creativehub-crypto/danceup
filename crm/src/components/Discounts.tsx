import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { formatMonth, monthOf, shiftMonth } from '../lib/dates';
import { formatMoney, parseMoney, todayMinsk } from '../lib/format';

interface DiscountRow {
  id: string;
  valid_from: string; // всегда 1 число месяца
  amount_kopecks: number;
}

// Скидка ученика в рублях В МЕСЯЦ: один раз вычитается из счёта (акта) ученика за месяц, во всех группах сразу.
// История по месяцам: «с месяца такого-то скидка X». Сумма 0 отменяет скидку с этого месяца.
// Видна и доступна только админу.
export default function Discounts({ studentId }: { studentId: string }) {
  const thisMonth = monthOf(todayMinsk());
  const [rows, setRows] = useState<DiscountRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('student_discounts')
      .select('id, valid_from, amount_kopecks')
      .eq('student_id', studentId)
      .order('valid_from', { ascending: false });
    if (error) return setLoadError(error.message);
    setLoadError(null);
    setRows((data ?? []) as DiscountRow[]);
  }, [studentId]);

  useEffect(() => {
    setRows(null);
    setOpen(false);
    void load();
  }, [load]);

  // Месяцы для выбора: два назад и год вперёд
  const monthOptions = useMemo(() => Array.from({ length: 15 }, (_, i) => shiftMonth(thisMonth, i - 2)), [thisMonth]);

  // Действующая сейчас скидка: последняя запись с началом не позже текущего месяца
  const current = (rows ?? []).find((r) => monthOf(r.valid_from) <= thisMonth) ?? null;
  const upcoming = (rows ?? []).filter((r) => monthOf(r.valid_from) > thisMonth);

  const openForm = () => {
    setAmount(current && current.amount_kopecks > 0 ? String(current.amount_kopecks / 100).replace('.', ',') : '');
    setFrom(thisMonth);
    setErr(null);
    setOpen(true);
  };

  const save = async () => {
    const kopecks = parseMoney(amount);
    if (kopecks === null) return setErr('Введите сумму числом, например 2 или 1,50. Чтобы отменить скидку, введите 0');
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from('student_discounts')
      .upsert({ student_id: studentId, valid_from: `${from}-01`, amount_kopecks: kopecks }, { onConflict: 'student_id,valid_from' });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    await load();
  };

  const remove = async (r: DiscountRow) => {
    if (!window.confirm(`Удалить запись «с ${formatMonth(monthOf(r.valid_from)).toLowerCase()}: ${formatMoney(r.amount_kopecks)} в месяц»?`)) return;
    const { data, error } = await supabase.from('student_discounts').delete().eq('id', r.id).select('id');
    if (error) return setErr(error.message);
    if (!data || data.length === 0) return setErr('Не удалось удалить: нет прав или запись не найдена');
    await load();
  };

  return (
    <section className="panel discount-panel">
      <div className="pay-head">
        <h2>Скидка</h2>
        {!open && (
          <button type="button" className="btn btn-accent btn-sm" onClick={openForm} disabled={!rows}>
            Добавить скидку
          </button>
        )}
      </div>

      {loadError && <p className="error">Не удалось загрузить скидки: {loadError}. Выполнена ли миграция 010?</p>}
      {!rows && !loadError && <span className="skeleton skeleton-line" style={{ width: '50%' }} />}

      {rows && (
        <p>
          {current && current.amount_kopecks > 0 ? (
            <>
              Сейчас: <strong>−{formatMoney(current.amount_kopecks)} в месяц</strong>: вычитается один раз из каждого счёта (акта), даже если ученик занимается в нескольких группах.
            </>
          ) : (
            <span className="muted">Скидки нет.</span>
          )}
        </p>
      )}

      {open && (
        <div className="discount-form">
          <label className="field">
            <span>Скидка в месяц, BYN</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2,00" autoFocus />
          </label>
          <label className="field">
            <span>Действует с месяца</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Эта сумма один раз вычитается из счёта ученика за каждый месяц (из каждого акта), начиная с выбранного месяца, пока скидка не изменена.
            Скидка не больше счёта за месяц. Чтобы отменить, введите 0 и месяц, с которого она больше не действует.
          </p>
          {err && <p className="error">{err}</p>}
          <div className="field-actions">
            <button type="button" className="btn btn-accent" onClick={save} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить скидку'}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {!open && err && <p className="error">{err}</p>}

      {upcoming.length > 0 && (
        <p className="muted small">
          Запланировано:{' '}
          {upcoming
            .slice()
            .reverse()
            .map((r) => `с ${formatMonth(monthOf(r.valid_from)).toLowerCase()}: ${r.amount_kopecks > 0 ? `−${formatMoney(r.amount_kopecks)} в месяц` : 'без скидки'}`)
            .join('; ')}
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <h3 className="section-title" style={{ fontSize: 15, margin: '12px 0 4px' }}>
            История скидок
          </h3>
          <div className="pay-list">
            {rows.map((r) => (
              <div key={r.id} className="pay-row">
                <span>с {formatMonth(monthOf(r.valid_from)).toLowerCase()}</span>
                <strong>{r.amount_kopecks > 0 ? `−${formatMoney(r.amount_kopecks)} в месяц` : 'без скидки'}</strong>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r)}>
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
