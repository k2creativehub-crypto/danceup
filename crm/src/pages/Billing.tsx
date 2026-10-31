import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import StudentSearch from '../components/StudentSearch';
import { SCHOOL } from '../lib/school';
import { formatMonth, monthBounds, monthOf, shiftMonth } from '../lib/dates';
import { formatDate, formatMoney, parseMoney, pluralYears, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';

type Tab = 'balance' | 'payment' | 'invoice' | 'group';

interface Balance {
  student_id: string;
  charged_kopecks: number;
  paid_kopecks: number;
  debt_kopecks: number;
}
interface InvoiceLine {
  student_id: string;
  student_name: string;
  birth_date: string | null;
  age_years: number | null;
  guardian_name: string | null;
  group_id: string;
  group_name: string;
  teacher_name: string;
  lessons_count: number;
  lessons_without_price: number;
  amount_kopecks: number;
}
interface Payment {
  id: string;
  paid_on: string;
  amount_kopecks: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

function Debt({ kopecks }: { kopecks: number }) {
  if (kopecks > 0) return <span className="debt-pos">долг {formatMoney(kopecks)}</span>;
  if (kopecks < 0) return <span className="debt-neg">переплата {formatMoney(-kopecks)}</span>;
  return <span className="muted">нет долга</span>;
}

// ---------- Печатная форма счёта ----------

function InvoiceSheet({ lines, ym }: { lines: InvoiceLine[]; ym: string }) {
  const first = lines[0];
  const total = lines.reduce((s, l) => s + l.amount_kopecks, 0);
  const noPrice = lines.reduce((s, l) => s + l.lessons_without_price, 0);
  const requisites = [
    SCHOOL.legalName,
    SCHOOL.unp ? `УНП ${SCHOOL.unp}` : '',
    SCHOOL.address,
    SCHOOL.account ? `р/с ${SCHOOL.account}` : '',
    SCHOOL.bank,
    SCHOOL.phone,
    SCHOOL.email,
  ].filter(Boolean);

  return (
    <div className="invoice-sheet">
      <div className="invoice-school">
        <div className="invoice-school-name">{SCHOOL.name}</div>
        {requisites.map((r) => (
          <div key={r} className="invoice-req">
            {r}
          </div>
        ))}
      </div>
      <h2 className="invoice-title">Счёт за {formatMonth(ym).toLowerCase()}</h2>
      <div className="invoice-meta">
        <div>
          <span className="muted">Ученик: </span>
          <strong>{first.student_name}</strong>
        </div>
        {first.age_years !== null && (
          <div>
            <span className="muted">Возраст: </span>
            {pluralYears(first.age_years)}
          </div>
        )}
        <div>
          <span className="muted">Дата формирования: </span>
          {formatDate(todayMinsk())}
        </div>
      </div>
      <table className="invoice-table">
        <thead>
          <tr>
            <th>Группа</th>
            <th>Преподаватель</th>
            <th className="num">Занятий</th>
            <th className="num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.group_id}>
              <td>{l.group_name}</td>
              <td>{l.teacher_name}</td>
              <td className="num">{l.lessons_count}</td>
              <td className="num">{formatMoney(l.amount_kopecks)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              <strong>Итого</strong>
            </td>
            <td className="num">
              <strong>{formatMoney(total)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
      {noPrice > 0 && (
        <p className="error no-print">
          Для {noPrice} занятий не задана цена, они не вошли в сумму. Задайте цену в разделе «Цены и расписание».
        </p>
      )}
    </div>
  );
}

// Строки счёта ученика: только группы, где за месяц есть занятия.
function studentInvoice(lines: InvoiceLine[], studentId: string): InvoiceLine[] {
  return lines.filter((l) => l.student_id === studentId && (l.lessons_count > 0 || l.lessons_without_price > 0));
}

// ---------- Вкладка «Баланс» ----------

function BalanceTab({
  rows,
  loading,
  error,
  ym,
  onPay,
  onInvoice,
}: {
  rows: Balance[] | null;
  loading: boolean;
  error: string | null;
  ym: string;
  onPay: (id: string) => void;
  onInvoice: (id: string) => void;
}) {
  const dir = useDirectory();
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);

  const groupOptions = useMemo(
    () => dir.groups.filter((g) => !g.is_archived).sort((a, b) => byName(a.name, b.name)),
    [dir.groups],
  );

  const list = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .map((b) => {
        const st = dir.studentById.get(b.student_id);
        const enrs = (dir.enrollmentsByStudent.get(b.student_id) ?? []).filter((e) => e.status !== 'reserve');
        return { b, st, enrs };
      })
      .filter((r) => r.st && (r.enrs.length > 0 || r.b.charged_kopecks > 0 || r.b.paid_kopecks > 0))
      .filter((r) => !groupId || r.enrs.some((e) => e.group_id === groupId))
      .filter((r) => !debtOnly || r.b.debt_kopecks > 0)
      .filter(
        (r) =>
          !q ||
          (r.st?.full_name ?? '').toLowerCase().includes(q) ||
          (r.st?.guardian?.full_name ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => b.b.debt_kopecks - a.b.debt_kopecks || byName(a.st?.full_name ?? '', b.st?.full_name ?? ''));
  }, [rows, dir.studentById, dir.enrollmentsByStudent, query, groupId, debtOnly]);

  const totalDebt = list.reduce((s, r) => s + Math.max(r.b.debt_kopecks, 0), 0);
  const totalOver = list.reduce((s, r) => s + Math.max(-r.b.debt_kopecks, 0), 0);

  return (
    <div>
      <div className="filters filters-balance">
        <input
          className="search"
          type="search"
          placeholder="Поиск: ученик или родитель"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Все группы</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.teacher?.full_name ?? ''}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} />
          Только с долгом
        </label>
      </div>

      {error && <p className="error">Не удалось загрузить баланс: {error}</p>}
      {loading && !rows && (
        <div>
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      )}

      {rows && (
        <>
          <p className="muted count">
            На конец периода «{formatMonth(ym).toLowerCase()}». Учеников: {list.length} · общий долг:{' '}
            <strong>{formatMoney(totalDebt)}</strong>
            {totalOver > 0 && <> · переплаты: {formatMoney(totalOver)}</>}
          </p>
          {list.length === 0 && <p className="muted">Никого не найдено.</p>}
          <div className="bal-list">
            {list.map(({ b, st, enrs }) => (
              <div key={b.student_id} className="bal-row">
                <div className="bal-name">
                  <strong>{st?.full_name}</strong>
                  <div className="muted small">
                    {enrs
                      .map((e) => dir.groupById.get(e.group_id)?.name)
                      .filter(Boolean)
                      .join(', ') || 'нет групп'}
                  </div>
                </div>
                <div className="bal-num">
                  <span className="muted small">начислено</span>
                  <span>{formatMoney(b.charged_kopecks)}</span>
                </div>
                <div className="bal-num">
                  <span className="muted small">оплачено</span>
                  <span>{formatMoney(b.paid_kopecks)}</span>
                </div>
                <div className="bal-num bal-debt">
                  <Debt kopecks={b.debt_kopecks} />
                </div>
                <div className="bal-actions">
                  <button type="button" className="btn btn-sm" onClick={() => onPay(b.student_id)}>
                    Оплата
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => onInvoice(b.student_id)}>
                    Счёт
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Вкладка «Оплата» ----------

function PaymentTab({
  studentId,
  onPick,
  onChanged,
}: {
  studentId: string | null;
  onPick: (id: string | null) => void;
  onChanged: () => void;
}) {
  const dir = useDirectory();
  const today = todayMinsk();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    (async () => {
      const [pa, ba] = await Promise.all([
        supabase
          .from('payments')
          .select('id, paid_on, amount_kopecks')
          .eq('student_id', studentId)
          .order('paid_on', { ascending: false }),
        supabase.rpc('student_balances', { p_to: todayMinsk() }),
      ]);
      if (!alive) return;
      if (pa.error) return setErr(pa.error.message);
      if (ba.error) return setErr(ba.error.message);
      setPayments((pa.data ?? []) as Payment[]);
      setBalance(((ba.data ?? []) as Balance[]).find((b) => b.student_id === studentId) ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [studentId, reload]);

  if (!studentId) {
    return (
      <div className="panel">
        <h2>Внести оплату</h2>
        <StudentSearch students={dir.students} excludeIds={new Set()} onPick={(s) => onPick(s.id)} autoFocus />
      </div>
    );
  }

  const st = dir.studentById.get(studentId);

  const add = async () => {
    const kopecks = parseMoney(amount);
    if (kopecks === null || kopecks <= 0) return setErr('Введите сумму числом, например 100 или 87,50');
    if (!date) return setErr('Укажите дату оплаты');
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from('payments')
      .insert({ student_id: studentId, paid_on: date, amount_kopecks: kopecks });
    setBusy(false);
    if (error) return setErr(error.message);
    setAmount('');
    setReload((v) => v + 1);
    onChanged();
  };

  const remove = async (p: Payment) => {
    if (!window.confirm(`Удалить оплату от ${formatDate(p.paid_on)} на ${formatMoney(p.amount_kopecks)}?`)) return;
    setErr(null);
    const { data, error } = await supabase.from('payments').delete().eq('id', p.id).select('id');
    if (error) return setErr(error.message);
    if (!data || data.length === 0) return setErr('Не удалось удалить: нет прав или запись не найдена');
    setReload((v) => v + 1);
    onChanged();
  };

  const paidTotal = (payments ?? []).reduce((s, p) => s + p.amount_kopecks, 0);

  return (
    <div>
      <div className="panel">
        <div className="pay-head">
          <h2>{st?.full_name ?? 'Ученик'}</h2>
          <button type="button" className="btn btn-sm" onClick={() => onPick(null)}>
            Сменить ученика
          </button>
        </div>
        {balance && (
          <p className="small">
            На сегодня: начислено {formatMoney(balance.charged_kopecks)} · оплачено {formatMoney(balance.paid_kopecks)} ·{' '}
            <Debt kopecks={balance.debt_kopecks} />
          </p>
        )}
        <div className="pay-form">
          <label className="field">
            <span>Дата оплаты</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Сумма, BYN</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100,00"
              autoFocus
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={add} disabled={busy}>
            {busy ? 'Вносим…' : 'Внести оплату'}
          </button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      <h3 className="section-title">История оплат</h3>
      {!payments && <span className="skeleton skeleton-line" style={{ width: '50%' }} />}
      {payments && payments.length === 0 && <p className="muted">Оплат пока нет.</p>}
      {payments && payments.length > 0 && (
        <>
          <div className="pay-list">
            {payments.map((p) => (
              <div key={p.id} className="pay-row">
                <span>{formatDate(p.paid_on)}</span>
                <strong>{formatMoney(p.amount_kopecks)}</strong>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(p)}>
                  Удалить
                </button>
              </div>
            ))}
          </div>
          <p className="muted small">Всего оплачено: {formatMoney(paidTotal)}</p>
        </>
      )}
    </div>
  );
}

// ---------- Вкладка «Счёт ребёнка» ----------

function InvoiceTab({
  studentId,
  onPick,
  ym,
  lines,
  loading,
  error,
  balance,
}: {
  studentId: string | null;
  onPick: (id: string | null) => void;
  ym: string;
  lines: InvoiceLine[] | null;
  loading: boolean;
  error: string | null;
  balance: Balance | null;
}) {
  const dir = useDirectory();

  if (!studentId) {
    return (
      <div className="panel no-print">
        <h2>Счёт ребёнка</h2>
        <StudentSearch students={dir.students} excludeIds={new Set()} onPick={(s) => onPick(s.id)} autoFocus />
      </div>
    );
  }

  const st = dir.studentById.get(studentId);
  const mine = lines ? studentInvoice(lines, studentId) : [];

  return (
    <div>
      <div className="pay-head no-print">
        <h2>{st?.full_name ?? 'Ученик'}</h2>
        <div className="field-actions">
          <button type="button" className="btn btn-sm" onClick={() => onPick(null)}>
            Сменить ученика
          </button>
          {mine.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
              Печать / PDF
            </button>
          )}
        </div>
      </div>
      {error && <p className="error no-print">Не удалось загрузить счёт: {error}</p>}
      {loading && !lines && <span className="skeleton skeleton-line no-print" style={{ width: '60%' }} />}
      {lines && mine.length === 0 && (
        <p className="muted no-print">
          За {formatMonth(ym).toLowerCase()} у ученика нет оплачиваемых занятий: нет отметок «+» или он не состоит в группе.
        </p>
      )}
      {mine.length > 0 && <InvoiceSheet lines={mine} ym={ym} />}
      {balance && (
        <div className="panel no-print">
          <h3>Баланс на конец периода</h3>
          <p>
            Начислено всего: {formatMoney(balance.charged_kopecks)} · оплачено: {formatMoney(balance.paid_kopecks)} ·{' '}
            <Debt kopecks={balance.debt_kopecks} />
          </p>
          <p className="muted small">Баланс считается нарастающим итогом и в печатный счёт не попадает.</p>
        </div>
      )}
    </div>
  );
}

// ---------- Вкладка «Счета группы» ----------

function GroupTab({
  ym,
  lines,
  loading,
  error,
}: {
  ym: string;
  lines: InvoiceLine[] | null;
  loading: boolean;
  error: string | null;
}) {
  const dir = useDirectory();
  const [groupId, setGroupId] = useState('');

  const groupOptions = useMemo(
    () => dir.groups.filter((g) => !g.is_archived).sort((a, b) => byName(a.name, b.name)),
    [dir.groups],
  );

  const members = useMemo(() => {
    if (!lines || !groupId) return [];
    return lines
      .filter((l) => l.group_id === groupId)
      .map((l) => ({ id: l.student_id, name: l.student_name, own: l }))
      .sort((x, y) => byName(x.name, y.name));
  }, [lines, groupId]);

  const toPrint = members.filter((m) => lines && studentInvoice(lines, m.id).length > 0);
  const withoutPrice = members.filter((m) => (m.own?.lessons_without_price ?? 0) > 0).length;

  return (
    <div>
      <div className="no-print">
        <label className="field" style={{ maxWidth: 460 }}>
          <span>Группа</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">— выберите группу —</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.teacher?.full_name ?? ''}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="error">Не удалось загрузить данные: {error}</p>}
        {loading && !lines && <span className="skeleton skeleton-line" style={{ width: '60%' }} />}

        {lines && groupId && (
          <>
            <p className="muted count">
              За {formatMonth(ym).toLowerCase()}: счетов к печати {toPrint.length} из {members.length}
              {withoutPrice > 0 && <span className="error"> · у {withoutPrice} учеников есть занятия без цены</span>}
            </p>
            {members.length === 0 && <p className="muted">В группе нет учеников со счётом за этот месяц.</p>}
            <div className="bal-list">
              {members.map((m) => {
                const own = m.own;
                const allLines = lines ? studentInvoice(lines, m.id) : [];
                const total = allLines.reduce((s, l) => s + l.amount_kopecks, 0);
                return (
                  <div key={m.id} className="bal-row bal-row-group">
                    <div className="bal-name">
                      <strong>{m.name}</strong>
                      {allLines.length > 1 && <div className="muted small">в счёте несколько групп</div>}
                    </div>
                    <div className="bal-num">
                      <span className="muted small">занятий в группе</span>
                      <span>{own?.lessons_count ?? 0}</span>
                    </div>
                    <div className="bal-num">
                      <span className="muted small">сумма счёта</span>
                      <span>{formatMoney(total)}</span>
                    </div>
                    <div className="bal-num">
                      {(own?.lessons_without_price ?? 0) > 0 ? (
                        <span className="error small">нет цены: {own?.lessons_without_price}</span>
                      ) : allLines.length === 0 ? (
                        <span className="muted small">нет занятий, счёт не печатается</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {toPrint.length > 0 && (
              <div className="field-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                  Печать всех счетов ({toPrint.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="print-only">
        {lines &&
          toPrint.map((m) => <InvoiceSheet key={m.id} lines={studentInvoice(lines, m.id)} ym={ym} />)}
      </div>
    </div>
  );
}

// ---------- Страница ----------

export default function Billing() {
  const dir = useDirectory();
  const today = todayMinsk();
  const [tab, setTab] = useState<Tab>('balance');
  const [ym, setYm] = useState(monthOf(today));
  const [studentId, setStudentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [balances, setBalances] = useState<{ key: string; rows: Balance[] } | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [linesByMonth, setLinesByMonth] = useState<Record<string, InvoiceLine[]>>({});
  const [linesError, setLinesError] = useState<string | null>(null);

  const balanceKey = `${ym}|${version}`;
  const needBalances = tab === 'balance' || tab === 'invoice';
  const needLines = tab === 'invoice' || tab === 'group';
  const haveLines = linesByMonth[ym] !== undefined;

  useEffect(() => {
    if (!needBalances || balances?.key === balanceKey) return;
    let alive = true;
    supabase.rpc('student_balances', { p_to: monthBounds(ym).to }).then(({ data, error }) => {
      if (!alive) return;
      if (error) return setBalanceError(error.message);
      setBalanceError(null);
      setBalances({ key: balanceKey, rows: (data ?? []) as Balance[] });
    });
    return () => {
      alive = false;
    };
  }, [needBalances, balanceKey, balances?.key, ym]);

  useEffect(() => {
    if (!needLines || haveLines) return;
    let alive = true;
    const { from, to } = monthBounds(ym);
    supabase.rpc('invoice_lines', { p_from: from, p_to: to, p_group_id: null }).then(({ data, error }) => {
      if (!alive) return;
      if (error) return setLinesError(error.message);
      setLinesError(null);
      setLinesByMonth((m) => ({ ...m, [ym]: (data ?? []) as InvoiceLine[] }));
    });
    return () => {
      alive = false;
    };
  }, [needLines, haveLines, ym]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);

  const balanceRows = balances && balances.key === balanceKey ? balances.rows : null;
  const myBalance = studentId && balanceRows ? balanceRows.find((b) => b.student_id === studentId) ?? null : null;
  const lines = linesByMonth[ym] ?? null;

  if (dir.loading) return <p className="muted">Загрузка…</p>;
  if (dir.error) return <p className="error">Не удалось загрузить данные: {dir.error}</p>;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'balance', label: 'Баланс' },
    { id: 'payment', label: 'Оплата' },
    { id: 'invoice', label: 'Счёт ребёнка' },
    { id: 'group', label: 'Счета группы' },
  ];

  return (
    <div className="billing-page">
      <div className="no-print">
        <h1>Оплаты и счета</h1>

        {tab !== 'payment' && (
          <div className="month-nav">
            <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setYm(shiftMonth(ym, -1))}>
              ‹
            </button>
            <div className="month-title">{formatMonth(ym)}</div>
            <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => setYm(shiftMonth(ym, 1))}>
              ›
            </button>
            {ym !== monthOf(today) && (
              <button type="button" className="btn btn-sm" onClick={() => setYm(monthOf(today))}>
                Текущий месяц
              </button>
            )}
          </div>
        )}

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'balance' && (
        <BalanceTab
          rows={balanceRows}
          loading={!balanceRows && !balanceError}
          error={balanceError}
          ym={ym}
          onPay={(id) => {
            setStudentId(id);
            setTab('payment');
          }}
          onInvoice={(id) => {
            setStudentId(id);
            setTab('invoice');
          }}
        />
      )}
      {tab === 'payment' && <PaymentTab studentId={studentId} onPick={setStudentId} onChanged={changed} />}
      {tab === 'invoice' && (
        <InvoiceTab
          studentId={studentId}
          onPick={setStudentId}
          ym={ym}
          lines={lines}
          loading={!lines && !linesError}
          error={linesError}
          balance={myBalance}
        />
      )}
      {tab === 'group' && <GroupTab ym={ym} lines={lines} loading={!lines && !linesError} error={linesError} />}
    </div>
  );
}
