import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import StudentSearch from '../components/StudentSearch';
import { SCHOOL } from '../lib/school';
import { formatDateGen, formatMonth, lastDayOfMonth, monthOf, shiftMonth } from '../lib/dates';
import { formatDate, formatMoney, parseMoney, pluralLessons, rub, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';

type Tab = 'balance' | 'payment' | 'invoice' | 'group';

interface Balance {
  student_id: string;
  charged_kopecks: number;
  paid_kopecks: number;
  debt_kopecks: number;
}
interface InvoiceRow {
  student_id: string;
  student_name: string;
  birth_date: string | null;
  age_years: number | null;
  guardian_name: string | null;
  group_id: string;
  group_name: string;
  teacher_name: string | null;
  contract_number: string | null;
  contract_date: string | null;
  lessons_count: number;
  price_kopecks: number | null;
  gross_kopecks: number;
  attended_count: number;
  absent_count: number;
  sick_count: number;
  trial_count: number;
  carry_count: number;
  carry_kopecks: number;
  credit_in_count: number;
  credit_in_kopecks: number;
  sick_adjust_kopecks: number;
  sick_pending: number;
  lessons_without_price: number;
  charge_kopecks: number;
  single_price_kopecks: number | null;
  discount_kopecks?: number | null; // скидка на месяц, вычтенная в этой строке
}
interface SickDate {
  group_id: string;
  group_name: string;
  lesson_date: string;
  kind: 'regular' | 'single' | null;
}
interface Payment {
  id: string;
  paid_on: string;
  amount_kopecks: number;
}

// Данные акта. Сохраняются в архив целиком, чтобы акт можно было открыть позже.
interface ActData {
  ym: string;
  studentName: string;
  guardianName: string | null;
  groups: { name: string; teacher: string }[];
  contractNumber: string | null;
  contractDate: string | null;
  lessons: number; // занятий в абонементе
  subscriptionKopecks: number; // стоимость абонемента
  used: number; // использовано занятий
  servicesKopecks: number; // общая стоимость услуг
  carryCount: number; // перенесено на следующий период
  carryKopecks: number;
  creditInCount: number; // зачтено с прошлого периода
  creditInKopecks: number;
  sickAdjustKopecks: number; // доплата за «б» по разовой цене
  discountKopecks?: number; // скидка ученика на месяц (в старых актах из архива поля нет)
  dueKopecks: number; // сумма к оплате за месяц
  debtKopecks: number; // задолженность на конец месяца
  actDate: string;
  issuedAt: string;
}
interface ArchiveRow {
  student_id: string;
  month: string;
  total_kopecks: number;
  payload: ActData;
  generated_at: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });
const firstDay = (ym: string) => `${ym}-01`;

function Debt({ kopecks }: { kopecks: number }) {
  if (kopecks > 0) return <span className="debt-pos">долг {formatMoney(kopecks)}</span>;
  if (kopecks < 0) return <span className="debt-neg">переплата {formatMoney(-kopecks)}</span>;
  return <span className="muted">нет долга</span>;
}

// Строки одного ученика за месяц, где что-то происходит (занятия, возврат, отметки).
function studentRows(rows: InvoiceRow[], studentId: string): InvoiceRow[] {
  return rows.filter((r) => r.student_id === studentId);
}

function buildAct(rows: InvoiceRow[], ym: string, debtKopecks: number): ActData {
  const sum = (f: (r: InvoiceRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const first = rows[0];
  const lessons = sum((r) => r.lessons_count);
  const gross = sum((r) => r.gross_kopecks);
  const carryCount = sum((r) => r.carry_count);
  const carryKopecks = sum((r) => r.carry_kopecks);
  const adjust = sum((r) => r.sick_adjust_kopecks);
  const creditIn = sum((r) => r.credit_in_kopecks);
  const contractRow = rows.find((r) => r.contract_number);
  const discount = sum((r) => r.discount_kopecks ?? 0);
  return {
    ym,
    studentName: first.student_name,
    guardianName: first.guardian_name,
    groups: rows.map((r) => ({ name: r.group_name, teacher: r.teacher_name ?? '' })),
    contractNumber: contractRow?.contract_number ?? null,
    contractDate: contractRow?.contract_date ?? null,
    lessons,
    subscriptionKopecks: gross,
    used: lessons - carryCount,
    servicesKopecks: gross - carryKopecks + adjust - discount,
    carryCount,
    carryKopecks,
    creditInCount: sum((r) => r.credit_in_count),
    creditInKopecks: creditIn,
    sickAdjustKopecks: adjust,
    discountKopecks: discount,
    dueKopecks: sum((r) => r.charge_kopecks),
    debtKopecks: Math.max(debtKopecks, 0),
    actDate: lastDayOfMonth(ym),
    issuedAt: todayMinsk(),
  };
}

// Что мешает сформировать акт ученика
function blockers(rows: InvoiceRow[]): string[] {
  const out: string[] = [];
  const noPrice = rows.reduce((s, r) => s + r.lessons_without_price, 0);
  if (noPrice > 0) out.push(`у ${noPrice} занятий не задана цена`);
  return out;
}

async function saveToArchive(items: { studentId: string; act: ActData }[]): Promise<string | null> {
  if (items.length === 0) return null;
  const { error } = await supabase.from('invoice_archive').upsert(
    items.map((i) => ({
      student_id: i.studentId,
      month: firstDay(i.act.ym),
      total_kopecks: i.act.dueKopecks,
      payload: i.act,
      generated_at: new Date().toISOString(),
    })),
    { onConflict: 'student_id,month' },
  );
  return error ? error.message : null;
}

// ---------- Печатная форма: акт приёмки оказанных услуг ----------

function ActSheet({ a }: { a: ActData }) {
  const blank = (v: string | null, empty: string) => (v && v.trim() ? v : empty);
  const customer = a.guardianName ?? a.studentName;
  const groupsText = a.groups.map((g) => (g.teacher ? `${g.name} (преподаватель ${g.teacher})` : g.name)).join('; ');

  return (
    <div className="act-sheet">
      <div className="act-title">АКТ</div>
      <div className="act-subtitle">
        приёмки оказанных услуг к договору №{blank(a.contractNumber, '____')} от{' '}
        {a.contractDate ? formatDate(a.contractDate) : '_________'}
      </div>
      <div className="act-place">
        <span>{SCHOOL.city}</span>
        <span>{formatDateGen(a.actDate)}</span>
      </div>

      <p className="act-p">
        {SCHOOL.fullName}, именуемое в дальнейшем «Исполнитель», действующее на основании Устава (свидетельство о
        государственной регистрации № {SCHOOL.registration}), с одной стороны, и {customer}, действующий(ая) от себя
        лично{a.guardianName ? ` (в интересах несовершеннолетнего) ${a.studentName}` : ''} именуемый(ая) в дальнейшем
        «Заказчик» (Термин Ученик применяется к Заказчику либо к несовершеннолетнему, чьи интересы представляет
        Заказчик), по отдельности именуемые в дальнейшем «Сторона», а совместно «Стороны» составили настоящий акт о том,
        что:
      </p>

      <ul className="act-list">
        <li>
          Исполнитель сдал, а Заказчик принял услуги по обучению танцам за {formatMonth(a.ym).toLowerCase()} года.
          Группа: {groupsText}.
        </li>
        <li>
          Заказчиком приобретен абонемент стоимостью {rub(a.subscriptionKopecks)} без НДС, включающий{' '}
          {pluralLessons(a.lessons)}.
          {a.creditInCount > 0 &&
            ` В счёт абонемента зачтено занятий, перенесённых с предыдущего периода: ${a.creditInCount}, стоимостью ${rub(a.creditInKopecks)} без НДС.`}
          {(a.discountKopecks ?? 0) > 0 && ` Заказчику предоставлена скидка ${rub(a.discountKopecks ?? 0)} без НДС.`}
        </li>
        <li>
          Заказчик посетил {pluralLessons(a.used)}. Абонемент использован {a.carryCount === 0 ? '' : 'не '}полностью.
          Общая стоимость услуг {rub(a.servicesKopecks)} без НДС. Перенесено на следующий период{' '}
          {pluralLessons(a.carryCount)}, стоимостью {rub(a.carryKopecks)} без НДС.
          {a.sickAdjustKopecks !== 0 &&
            ` Занятия по болезни оплачены по цене разового занятия, разница составила ${rub(a.sickAdjustKopecks)} без НДС.`}
        </li>
        <li>
          {a.debtKopecks > 0
            ? `Стоимость абонемента оплачена до момента подписания настоящего акта не в полном объёме (имеется задолженность ${rub(a.debtKopecks)} без НДС).`
            : 'Стоимость абонемента оплачена до момента подписания настоящего акта в полном объёме.'}
        </li>
        <li>Услуги оказаны надлежащим образом и в срок, стороны претензий друг к другу не имеют.</li>
        <li>Настоящий акт составлен Исполнителем в одностороннем порядке согласно п. 3.7. договора на оказание услуг.</li>
      </ul>

      <div className="act-executor">
        <div className="act-executor-title">ИСПОЛНИТЕЛЬ</div>
        <div>{SCHOOL.shortName}</div>
        <div>{SCHOOL.address}</div>
        <div>УНП {SCHOOL.unp}</div>
        <div>Банковские реквизиты:</div>
        <div>р/с {SCHOOL.account}</div>
        <div>в {SCHOOL.bank},</div>
        <div>адрес банка: {SCHOOL.bankAddress}</div>
        <div>BIC: {SCHOOL.bic}</div>
        <div className="act-sign">_________________ {SCHOOL.director}</div>
      </div>
    </div>
  );
}

// ---------- Вкладка «Баланс» ----------

function BalanceTab({ ym, onPay }: { ym: string; onPay: (id: string) => void }) {
  const dir = useDirectory();
  const [rows, setRows] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startYm, setStartYm] = useState<string | null>(null);
  const [startDraft, setStartDraft] = useState('');
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [archived, setArchived] = useState<Map<string, number>>(new Map());

  // Ученики, у которых за выбранный месяц уже сформирован акт, и его сумма
  useEffect(() => {
    let alive = true;
    supabase
      .from('invoice_archive')
      .select('student_id, total_kopecks')
      .eq('month', firstDay(ym))
      .then(({ data }) => {
        if (!alive || !data) return;
        setArchived(
          new Map<string, number>((data as { student_id: string; total_kopecks: number }[]).map((r) => [r.student_id, r.total_kopecks])),
        );
      });
    return () => {
      alive = false;
    };
  }, [ym, reload]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    supabase.rpc('student_balances', { p_to: lastDayOfMonth(ym) }).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) return setError(e.message);
      setError(null);
      setRows((data ?? []) as Balance[]);
    });
    return () => {
      alive = false;
    };
  }, [ym, reload]);

  useEffect(() => {
    let alive = true;
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'billing_start')
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const v = (data as { value: string } | null)?.value;
        if (v) {
          setStartYm(v.slice(0, 7));
          setStartDraft(v.slice(0, 7));
        }
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const saveStart = async () => {
    if (!/^\d{4}-\d{2}$/.test(startDraft)) return setSettingsErr('Выберите месяц');
    if (
      !window.confirm(
        `Начисления и возвраты будут считаться с месяца «${formatMonth(startDraft).toLowerCase()}». Все балансы пересчитаются. Продолжить?`,
      )
    )
      return;
    setSettingsErr(null);
    const { error: e } = await supabase
      .from('app_settings')
      .upsert({ key: 'billing_start', value: firstDay(startDraft) }, { onConflict: 'key' });
    if (e) return setSettingsErr(e.message);
    setReload((v) => v + 1);
  };

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
      .filter((r) => r.st && (r.enrs.length > 0 || r.b.charged_kopecks !== 0 || r.b.paid_kopecks > 0))
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
      <div className="panel start-panel no-print">
        <div className="start-row">
          <label className="field">
            <span>Начисления ведутся с месяца</span>
            <input type="month" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} />
          </label>
          <button type="button" className="btn btn-sm" onClick={saveStart} disabled={!startYm || startDraft === startYm}>
            Сохранить
          </button>
        </div>
        <p className="muted small">
          Месяцы до этой даты не начисляются, и возвраты с предыдущего месяца в первом месяце не применяются. Оплаты
          учитываются любые.
        </p>
        {settingsErr && <p className="error">{settingsErr}</p>}
      </div>

      <div className="filters filters-balance no-print">
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

      {error && <p className="error no-print">Не удалось загрузить баланс: {error}</p>}
      {!rows && !error && (
        <div className="no-print">
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      )}

      {rows && (
        <>
          <p className="muted count no-print">
            На конец периода «{formatMonth(ym).toLowerCase()}». Учеников: {list.length} · общий долг:{' '}
            <strong>{formatMoney(totalDebt)}</strong>
            {totalOver > 0 && <> · переплаты: {formatMoney(totalOver)}</>}
          </p>
          {list.length === 0 && <p className="muted no-print">Никого не найдено.</p>}
          <div className="bal-list">
            {list.map(({ b, st, enrs }) => (
              <div key={b.student_id} className="bal-item">
                <div className="bal-row no-print">
                  <div className="bal-name">
                    <strong>{st?.full_name}</strong>
                    <div className="muted small">
                      {enrs
                        .map((e) => dir.groupById.get(e.group_id)?.name)
                        .filter(Boolean)
                        .join(', ') || 'нет групп'}
                    </div>
                    {archived.has(b.student_id) && (
                      <div className="small bal-archived">
                        акт за месяц сформирован · {formatMoney(archived.get(b.student_id) ?? 0)}
                      </div>
                    )}
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
                    <button
                      type="button"
                      className={`btn btn-sm${openId === b.student_id ? ' btn-primary' : ''}`}
                      onClick={() => setOpenId(openId === b.student_id ? null : b.student_id)}
                    >
                      {openId === b.student_id ? 'Свернуть' : 'Подробнее'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => onPay(b.student_id)}>
                      Оплата
                    </button>
                  </div>
                </div>
                {openId === b.student_id && (
                  <div className="bal-detail">
                    <StudentMonthCard key={`${b.student_id}|${ym}`} studentId={b.student_id} ym={ym} onChanged={() => setReload((v) => v + 1)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Вкладка «Оплата» ----------

// ---------- Оплата по группе: выбрать группу и внести оплату каждому ученику ----------

function GroupPayments({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const dir = useDirectory();
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(todayMinsk());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [discounts, setDiscounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ba, di] = await Promise.all([
        supabase.rpc('student_balances', { p_to: todayMinsk() }),
        supabase.from('student_discounts').select('student_id, valid_from, amount_kopecks').limit(10000),
      ]);
      if (!alive) return;
      if (ba.error) return setErr(ba.error.message);
      setBalances((ba.data ?? []) as Balance[]);
      // Действующая сейчас скидка: последняя запись с началом не позже текущего месяца
      if (!di.error) {
        const thisMonth = monthOf(todayMinsk());
        const latest = new Map<string, { from: string; amount: number }>();
        for (const r of (di.data ?? []) as { student_id: string; valid_from: string; amount_kopecks: number }[]) {
          if (monthOf(r.valid_from) > thisMonth) continue;
          const cur = latest.get(r.student_id);
          if (!cur || r.valid_from > cur.from) latest.set(r.student_id, { from: r.valid_from, amount: r.amount_kopecks });
        }
        setDiscounts(new Map([...latest].map(([id, v]) => [id, v.amount])));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const groupOptions = useMemo(
    () => dir.groups.filter((g) => !g.is_archived).sort((a, b) => byName(a.name, b.name)),
    [dir.groups],
  );

  // Ученики группы: занимаются и выбывшие (резерв не платит)
  const members = useMemo(() => {
    if (!groupId) return [];
    const seen = new Set<string>();
    const list: { id: string; name: string; status: string }[] = [];
    for (const e of dir.enrollmentsByGroup.get(groupId) ?? []) {
      if (e.status === 'reserve' || seen.has(e.student_id)) continue;
      const st = dir.studentById.get(e.student_id);
      if (!st) continue;
      seen.add(e.student_id);
      list.push({ id: st.id, name: st.full_name, status: e.status });
    }
    return list.sort((a, b) => byName(a.name, b.name));
  }, [groupId, dir.enrollmentsByGroup, dir.studentById]);

  const entered = members
    .map((m) => ({ m, text: (amounts[m.id] ?? '').trim() }))
    .filter((x) => x.text !== '');
  const parsed = entered.map((x) => ({ ...x, kopecks: parseMoney(x.text) }));
  const total = parsed.reduce((sum, x) => sum + (x.kopecks && x.kopecks > 0 ? x.kopecks : 0), 0);

  const pickGroup = (id: string) => {
    setGroupId(id);
    setAmounts({});
    setErr(null);
    setDone(null);
  };

  const save = async () => {
    setDone(null);
    if (parsed.length === 0) return setErr('Введите сумму хотя бы одному ученику');
    const bad = parsed.find((x) => x.kopecks === null || x.kopecks <= 0);
    if (bad) return setErr(`Сумма у ученика «${bad.m.name}» указана неверно. Введите число, например 100 или 87,50`);
    if (!date) return setErr('Укажите дату оплаты');
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from('payments')
      .insert(parsed.map((x) => ({ student_id: x.m.id, paid_on: date, amount_kopecks: x.kopecks as number })));
    setBusy(false);
    if (error) return setErr(`Оплаты не внесены: ${error.message}`);
    setDone(`Внесено оплат: ${parsed.length} на сумму ${formatMoney(total)} (дата ${formatDate(date)}).`);
    setAmounts({});
    setReload((v) => v + 1);
  };

  return (
    <div className="panel">
      <h2>Оплата по группе</h2>
      <div className="pay-group-top">
        <label className="field" style={{ maxWidth: 460 }}>
          <span>Группа</span>
          <select value={groupId} onChange={(e) => pickGroup(e.target.value)}>
            <option value="">— выберите группу —</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.teacher?.full_name ?? ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Дата оплаты</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {groupId && members.length === 0 && <p className="muted">В группе нет учеников, которые платят.</p>}

      {groupId && members.length > 0 && (
        <>
          <div className="bal-list">
            {members.map((m) => {
              const b = balances?.find((x) => x.student_id === m.id);
              const disc = discounts.get(m.id) ?? 0;
              return (
                <div key={m.id} className="pay-group-row">
                  <div className="pay-group-name">
                    <strong>{m.name}</strong>
                    {m.status === 'left' && <span className="muted small"> · выбыл(а)</span>}
                  </div>
                  <div className="pay-group-info">
                    {b ? <Debt kopecks={b.debt_kopecks} /> : <span className="muted">…</span>}
                    {disc > 0 && <span className="discount-badge">скидка −{formatMoney(disc)} / мес</span>}
                    <button type="button" className="btn btn-sm" onClick={() => onOpenStudent(m.id)}>
                      История оплат
                    </button>
                  </div>
                  <input
                    className="pay-group-amount"
                    inputMode="decimal"
                    placeholder="Сумма, BYN"
                    aria-label={`Сумма оплаты: ${m.name}`}
                    value={amounts[m.id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>

          {err && <p className="error">{err}</p>}
          {done && <p className="debt-neg">{done}</p>}
          <div className="field-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || entered.length === 0}>
              {busy ? 'Вносим…' : entered.length > 0 ? `Внести оплаты (${entered.length}) на ${formatMoney(total)}` : 'Внести оплаты'}
            </button>
            {entered.length > 0 && (
              <button type="button" className="btn" onClick={() => setAmounts({})} disabled={busy}>
                Очистить суммы
              </button>
            )}
          </div>
          <p className="muted small">Долг показан на сегодня. Пустые поля пропускаются. Оплаты сохраняются все сразу.</p>
        </>
      )}
      {!groupId && err && <p className="error">{err}</p>}
    </div>
  );
}

function PaymentTab({ studentId, onPick }: { studentId: string | null; onPick: (id: string | null) => void }) {
  const dir = useDirectory();
  const today = todayMinsk();
  const [mode, setMode] = useState<'student' | 'group'>('student');
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
      <div>
        <div className="tabs pay-mode" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'student'} className={`tab${mode === 'student' ? ' is-active' : ''}`} onClick={() => setMode('student')}>
            По ученику
          </button>
          <button type="button" role="tab" aria-selected={mode === 'group'} className={`tab${mode === 'group' ? ' is-active' : ''}`} onClick={() => setMode('group')}>
            По группе
          </button>
        </div>
        {mode === 'student' ? (
          <div className="panel">
            <h2>Внести оплату</h2>
            <StudentSearch students={dir.students} excludeIds={new Set()} onPick={(s) => onPick(s.id)} autoFocus />
          </div>
        ) : (
          <GroupPayments onOpenStudent={(id) => onPick(id)} />
        )}
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
  };

  const remove = async (p: Payment) => {
    if (!window.confirm(`Удалить оплату от ${formatDate(p.paid_on)} на ${formatMoney(p.amount_kopecks)}?`)) return;
    setErr(null);
    const { data, error } = await supabase.from('payments').delete().eq('id', p.id).select('id');
    if (error) return setErr(error.message);
    if (!data || data.length === 0) return setErr('Не удалось удалить: нет прав или запись не найдена');
    setReload((v) => v + 1);
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

// ---------- Карточка ученика за месяц: выписка, «б», акт ----------

interface StudentMonthData {
  rows: InvoiceRow[];
  sick: SickDate[];
  debt: Balance | null;
  archive: ArchiveRow[];
}

function useStudentMonth(studentId: string, ym: string) {
  const [data, setData] = useState<StudentMonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [inv, sd, ba, ar] = await Promise.all([
        supabase.rpc('month_invoices', { p_month: firstDay(ym), p_group_id: null, p_student_id: studentId }),
        supabase.rpc('sick_dates', { p_month: firstDay(ym), p_student_id: studentId }),
        supabase.rpc('student_balances', { p_to: lastDayOfMonth(ym) }),
        supabase
          .from('invoice_archive')
          .select('student_id, month, total_kopecks, payload, generated_at')
          .eq('student_id', studentId)
          .order('month', { ascending: false }),
      ]);
      if (!alive) return;
      const firstError = inv.error ?? sd.error ?? ba.error ?? ar.error;
      if (firstError) return setError(firstError.message);
      setError(null);
      setData({
        rows: (inv.data ?? []) as InvoiceRow[],
        sick: (sd.data ?? []) as SickDate[],
        debt: ((ba.data ?? []) as Balance[]).find((b) => b.student_id === studentId) ?? null,
        archive: (ar.data ?? []) as ArchiveRow[],
      });
    })();
    return () => {
      alive = false;
    };
  }, [studentId, ym, reload]);

  return { data, error, reload: () => setReload((v) => v + 1) };
}

// Выписка: сколько занятий по какой цене
function Breakdown({ rows, sick }: { rows: InvoiceRow[]; sick: SickDate[] }) {
  return (
    <div className="no-print">
      {rows.map((r) => {
        const p = r.price_kopecks;
        const single = r.single_price_kopecks;
        const sd = sick.filter((d) => d.group_id === r.group_id);
        const sickPaid = r.sick_count > 0 && r.sick_count <= 4;
        const nRegular = sickPaid ? sd.filter((d) => d.kind === 'regular' || single == null).length : 0;
        const nSingle = sickPaid ? r.sick_count - nRegular : 0;

        const lines: { label: string; n: number; price: number | null; sum: number }[] = [];
        if (r.attended_count > 0) {
          lines.push({ label: '«+» был(а)', n: r.attended_count, price: p, sum: r.attended_count * (p ?? 0) });
        }
        if (r.absent_count > 0) {
          lines.push({ label: '«−» не был(а), оплачивается как «+»', n: r.absent_count, price: p, sum: r.absent_count * (p ?? 0) });
        }
        if (nSingle > 0) {
          lines.push({ label: '«б» по тарифу разового занятия', n: nSingle, price: single, sum: nSingle * (single ?? 0) });
        }
        if (nRegular > 0) {
          lines.push({ label: '«б» по регулярному тарифу', n: nRegular, price: p, sum: nRegular * (p ?? 0) });
        }
        if (r.sick_count > 4) {
          lines.push({ label: '«б» больше 4 за месяц: не оплачиваются', n: r.sick_count, price: null, sum: 0 });
        }
        if (r.trial_count > 0) {
          lines.push({ label: '«п» пробное: не оплачивается', n: r.trial_count, price: null, sum: 0 });
        }
        const services = lines.reduce((s, l) => s + l.sum, 0);

        return (
          <div key={r.group_id} className="detail-group">
            <h4>
              {r.group_name}
              {r.teacher_name && <span className="muted"> · {r.teacher_name}</span>}
            </h4>
            {r.lessons_without_price > 0 && (
              <p className="error small">У группы не задана регулярная цена, суммы по занятиям посчитать нельзя.</p>
            )}
            <table className="detail-table">
              <thead>
                <tr>
                  <th>Отметка</th>
                  <th className="num">Занятий</th>
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td className="num">{l.n}</td>
                    <td className="num">{l.price === null ? '—' : formatMoney(l.price)}</td>
                    <td className="num">{formatMoney(l.sum)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Занятий в этом месяце нет.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Стоимость услуг за месяц</td>
                  <td className="num">{formatMoney(services)}</td>
                </tr>
              </tfoot>
            </table>
            {(r.discount_kopecks ?? 0) > 0 && (
              <p className="small">
                Скидка ученика на месяц: −{formatMoney(r.discount_kopecks ?? 0)} (вычтена один раз из суммы к оплате; при нескольких группах показана в первой по алфавиту).
              </p>
            )}
            {r.carry_count > 0 && (
              <p className="small">
                Перенесётся на следующий месяц: {pluralLessons(r.carry_count)}, {formatMoney(r.carry_kopecks)}.
              </p>
            )}
            <p className="small detail-total">
              Выставлено к оплате: абонемент {r.lessons_count} × {p === null ? '—' : formatMoney(p)} = {formatMoney(r.gross_kopecks)}
              {r.sick_adjust_kopecks !== 0 && <>; доплата за «б» по разовому тарифу {formatMoney(r.sick_adjust_kopecks)}</>}
              {r.credit_in_kopecks > 0 && <>; зачтено с прошлого месяца −{formatMoney(r.credit_in_kopecks)}</>}
              {(r.discount_kopecks ?? 0) > 0 && <>; скидка −{formatMoney(r.discount_kopecks ?? 0)}</>}
              {' '}
              → <strong>{formatMoney(r.charge_kopecks)}</strong>
            </p>
          </div>
        );
      })}
    </div>
  );
}

// «б» (болезнь): по умолчанию по разовому тарифу, можно пересчитать в регулярное
function SickPanel({
  rows,
  sick,
  busy,
  onChoose,
  onAllRegular,
}: {
  rows: InvoiceRow[];
  sick: SickDate[];
  busy: boolean;
  onChoose: (d: SickDate, kind: 'regular' | 'single') => void;
  onAllRegular: () => void;
}) {
  const sickByGroup = new Map<string, number>();
  for (const r of rows) sickByGroup.set(r.group_id, r.sick_count);
  const choosable = sick.filter((d) => (sickByGroup.get(d.group_id) ?? 0) <= 4);
  const unpaid = rows.filter((r) => r.sick_count > 4);
  const priceFor = (d: SickDate) => rows.find((r) => r.group_id === d.group_id);

  if (choosable.length === 0 && unpaid.length === 0) return null;

  return (
    <div className="no-print">
      {choosable.length > 0 && (
        <div className="panel">
          <h3>«б» (болезнь): пересчёт по тарифу разового занятия</h3>
          <p className="muted small">
            За месяц «б» не больше 4, поэтому они пересчитаны по цене разового занятия. Если нужно, пересчитайте нужную
            дату в регулярное. Если «б» больше 4, они не оплачиваются и переносятся на следующий месяц.
          </p>
          {choosable.filter((d) => (d.kind ?? 'single') === 'single').length > 1 && (
            <div className="field-actions" style={{ marginBottom: 8 }}>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={onAllRegular}>
                Пересчитать все в регулярное
              </button>
            </div>
          )}
          {choosable.map((d) => {
            const r = priceFor(d);
            const kind = d.kind ?? 'single';
            const noSingle = r?.single_price_kopecks == null;
            return (
              <div key={`${d.group_id}-${d.lesson_date}`} className="sick-row">
                <div>
                  {formatDate(d.lesson_date)}
                  <span className="muted small"> · {d.group_name}</span>
                  <div className="small">
                    {kind === 'regular' ? (
                      <>пересчитано по регулярному тарифу{r?.price_kopecks != null ? ` · ${formatMoney(r.price_kopecks)}` : ''}</>
                    ) : noSingle ? (
                      <span className="error">разовая цена группы не задана, «б» считается по регулярной</span>
                    ) : (
                      <>пересчёт «б» по тарифу разового занятия · {formatMoney(r?.single_price_kopecks ?? 0)}</>
                    )}
                  </div>
                </div>
                <div className="sick-choice">
                  {kind === 'single' ? (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onChoose(d, 'regular')}>
                      Пересчитать в регулярное
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy || noSingle}
                      onClick={() => onChoose(d, 'single')}
                      title={noSingle ? 'У группы не задана разовая цена' : ''}
                    >
                      Вернуть по разовому
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {unpaid.length > 0 && (
        <p className="muted small">
          «б» больше 4 за месяц: {unpaid.map((r) => `${r.group_name} (${r.sick_count})`).join(', ')}. Они не оплачиваются,{' '}
          {pluralLessons(unpaid.reduce((s, r) => s + r.sick_count, 0))} перенесутся на следующий месяц.
        </p>
      )}
    </div>
  );
}

function StudentMonthCard({
  studentId,
  ym,
  initialAct,
  onChanged,
}: {
  studentId: string;
  ym: string;
  initialAct?: boolean;
  onChanged?: () => void;
}) {
  const { data, error, reload } = useStudentMonth(studentId, ym);
  const [showAct, setShowAct] = useState(!!initialAct);
  const [viewing, setViewing] = useState<ActData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    reload();
    onChanged?.();
  };

  if (error) return <p className="error no-print">Не удалось загрузить данные: {error}</p>;
  if (!data) {
    return (
      <div className="no-print">
        <span className="skeleton skeleton-line" style={{ width: '60%' }} />
        <span className="skeleton skeleton-line" />
      </div>
    );
  }

  const mine = studentRows(data.rows, studentId);
  const stop = blockers(mine);
  const act = mine.length > 0 ? buildAct(mine, ym, data.debt?.debt_kopecks ?? 0) : null;
  const shown = viewing ?? act;
  const archivedThis = data.archive.find((a) => monthOf(a.month) === ym) ?? null;

  const choose = async (d: SickDate, kind: 'regular' | 'single') => {
    setBusy(true);
    setErr(null);
    const { error: e } = await supabase
      .from('sick_pricing')
      .upsert(
        { group_id: d.group_id, student_id: studentId, lesson_date: d.lesson_date, kind },
        { onConflict: 'group_id,student_id,lesson_date' },
      );
    setBusy(false);
    if (e) return setErr(e.message);
    refresh();
  };

  const allRegular = async () => {
    const sickByGroup = new Map<string, number>();
    for (const r of mine) sickByGroup.set(r.group_id, r.sick_count);
    const todo = data.sick.filter((d) => (sickByGroup.get(d.group_id) ?? 0) <= 4 && (d.kind ?? 'single') === 'single');
    if (todo.length === 0) return;
    setBusy(true);
    setErr(null);
    const { error: e } = await supabase.from('sick_pricing').upsert(
      todo.map((d) => ({ group_id: d.group_id, student_id: studentId, lesson_date: d.lesson_date, kind: 'regular' })),
      { onConflict: 'group_id,student_id,lesson_date' },
    );
    setBusy(false);
    if (e) return setErr(e.message);
    refresh();
  };

  const print = () => {
    setShowAct(true);
    // даём странице нарисовать акт и только потом открываем печать
    setTimeout(() => window.print(), 100);
  };

  const makePdf = async () => {
    if (!act) return;
    setBusy(true);
    setErr(null);
    const saveErr = await saveToArchive([{ studentId, act }]);
    setBusy(false);
    if (saveErr) setErr(`Акт не сохранён в архив: ${saveErr}`);
    setShowAct(true);
    setTimeout(() => {
      window.print();
      if (!saveErr) refresh();
    }, 100);
  };

  return (
    <div className="student-card">
      <div className="no-print">
        <div className="field-actions" style={{ marginBottom: 8 }}>
          {viewing ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setViewing(null)}>
                Закрыть сохранённый акт
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={print}>
                Печать / PDF
              </button>
            </>
          ) : (
            act && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => setShowAct((v) => !v)}>
                  {showAct ? 'Скрыть акт' : 'Показать акт'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={makePdf} disabled={busy || stop.length > 0}>
                  Сформировать PDF
                </button>
              </>
            )
          )}
        </div>
        {err && <p className="error">{err}</p>}
        {!viewing && stop.length > 0 && <p className="error">Акт нельзя сформировать: {stop.join('; ')}.</p>}
        {mine.length === 0 && !viewing && (
          <p className="muted">
            За {formatMonth(ym).toLowerCase()} у ученика нет занятий по расписанию: он не состоит в группе или у группы нет
            расписания.
          </p>
        )}
      </div>

      {!viewing && mine.length > 0 && <Breakdown rows={mine} sick={data.sick} />}
      {!viewing && <SickPanel rows={mine} sick={data.sick} busy={busy} onChoose={choose} onAllRegular={allRegular} />}

      {showAct && shown && <ActSheet a={shown} />}

      {!viewing && act && (
        <div className="panel no-print">
          <h3>К оплате за {formatMonth(ym).toLowerCase()}</h3>
          <p>
            <strong>{formatMoney(act.dueKopecks)}</strong>
            {data.debt && (
              <>
                {' '}
                · баланс на конец месяца: <Debt kopecks={data.debt.debt_kopecks} />
              </>
            )}
          </p>
          {archivedThis && archivedThis.total_kopecks !== act.dueKopecks && (
            <p className="error small">
              В сформированном акте была сумма {formatMoney(archivedThis.total_kopecks)}, сейчас расчёт даёт{' '}
              {formatMoney(act.dueKopecks)}: отметки или цены менялись после формирования.
            </p>
          )}
          <p className="muted small">Расчёт считается на сегодняшних данных и меняется, если поправить отметки или цены.</p>
        </div>
      )}

      <div className="panel no-print">
        <h3>Сформированные акты</h3>
        {data.archive.length === 0 ? (
          <p className="muted small">Акты пока не формировались. После нажатия «Сформировать PDF» акт появится здесь.</p>
        ) : (
          <>
            <p className="muted small">Сумма и текст акта сохраняются при каждом формировании PDF.</p>
            <div className="pay-list">
              {data.archive.map((a) => (
                <div key={a.month} className="pay-row">
                  <span>{formatMonth(monthOf(a.month))}</span>
                  <strong>{formatMoney(a.total_kopecks)}</strong>
                  <span className="muted small">от {formatDate(a.generated_at.slice(0, 10))}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setViewing(a.payload);
                      setShowAct(true);
                    }}
                  >
                    Открыть
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Вкладка «Акт ученика» ----------

function InvoiceTab({ studentId, onPick, ym }: { studentId: string | null; onPick: (id: string | null) => void; ym: string }) {
  const dir = useDirectory();

  if (!studentId) {
    return (
      <div className="panel no-print">
        <h2>Акт ученика</h2>
        <StudentSearch students={dir.students} excludeIds={new Set()} onPick={(s) => onPick(s.id)} autoFocus />
      </div>
    );
  }

  const st = dir.studentById.get(studentId);

  return (
    <div>
      <div className="pay-head no-print">
        <h2>{st?.full_name ?? 'Ученик'}</h2>
        <button type="button" className="btn btn-sm" onClick={() => onPick(null)}>
          Сменить ученика
        </button>
      </div>
      <StudentMonthCard key={`${studentId}|${ym}`} studentId={studentId} ym={ym} initialAct />
    </div>
  );
}

// ---------- Вкладка «Акты группы» ----------

function GroupTab({ ym, onOpen }: { ym: string; onOpen: (id: string) => void }) {
  const dir = useDirectory();
  const [groupId, setGroupId] = useState('');
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    (async () => {
      const [inv, ba] = await Promise.all([
        supabase.rpc('month_invoices', { p_month: firstDay(ym), p_group_id: null, p_student_id: null }),
        supabase.rpc('student_balances', { p_to: lastDayOfMonth(ym) }),
      ]);
      if (!alive) return;
      const firstError = inv.error ?? ba.error;
      if (firstError) return setError(firstError.message);
      setError(null);
      setRows((inv.data ?? []) as InvoiceRow[]);
      setBalances((ba.data ?? []) as Balance[]);
    })();
    return () => {
      alive = false;
    };
  }, [ym]);

  const groupOptions = useMemo(
    () => dir.groups.filter((g) => !g.is_archived).sort((a, b) => byName(a.name, b.name)),
    [dir.groups],
  );

  const members = useMemo(() => {
    if (!rows || !groupId) return [];
    const ids = [...new Set<string>(rows.filter((r) => r.group_id === groupId).map((r) => r.student_id))];
    return ids
      .map((id) => {
        const all = studentRows(rows, id);
        const own = all.find((r) => r.group_id === groupId);
        const debt = balances?.find((b) => b.student_id === id)?.debt_kopecks ?? 0;
        return { id, name: own?.student_name ?? '', own, all, stop: blockers(all), act: buildAct(all, ym, debt) };
      })
      .sort((a, b) => byName(a.name, b.name));
  }, [rows, groupId, balances, ym]);

  const ready = members.filter((m) => m.stop.length === 0 && m.act.lessons + m.act.creditInCount > 0);
  const blocked = members.filter((m) => m.stop.length > 0);

  const printAll = async () => {
    setBusy(true);
    const err = await saveToArchive(ready.map((m) => ({ studentId: m.id, act: m.act })));
    setBusy(false);
    if (err) setError(`Акты не сохранены в архив: ${err}`);
    window.print();
  };

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

        {error && <p className="error">{error}</p>}
        {!rows && !error && <span className="skeleton skeleton-line" style={{ width: '60%' }} />}

        {rows && groupId && (
          <>
            <p className="muted count">
              За {formatMonth(ym).toLowerCase()}: актов к печати {ready.length} из {members.length}
              {blocked.length > 0 && <span className="error"> · требуют внимания: {blocked.length}</span>}
            </p>
            {members.length === 0 && <p className="muted">В группе нет занятий за этот месяц.</p>}
            <div className="bal-list">
              {members.map((m) => (
                <div key={m.id} className="bal-row bal-row-group">
                  <div className="bal-name">
                    <strong>{m.name}</strong>
                    {m.all.length > 1 && <div className="muted small">в акте несколько групп</div>}
                  </div>
                  <div className="bal-num">
                    <span className="muted small">занятий в группе</span>
                    <span>{m.own?.lessons_count ?? 0}</span>
                  </div>
                  <div className="bal-num">
                    <span className="muted small">к оплате за месяц</span>
                    <span>{formatMoney(m.act.dueKopecks)}</span>
                  </div>
                  <div className="bal-num">
                    {m.stop.length > 0 ? (
                      <span className="error small">{m.stop.join('; ')}</span>
                    ) : (
                      <span className="muted small">готов к печати</span>
                    )}
                    {m.all.some((r) => r.sick_count > 0 && r.sick_count <= 4) && (
                      <span className="muted small">есть «б»: пересчитаны по разовому тарифу</span>
                    )}
                    {(m.stop.length > 0 || m.all.some((r) => r.sick_count > 0 && r.sick_count <= 4)) && (
                      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => onOpen(m.id)}>
                        Открыть
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {ready.length > 0 && (
              <div className="field-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-primary" onClick={printAll} disabled={busy}>
                  Сформировать PDF всех актов ({ready.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="print-only">
        {ready.map((m) => (
          <ActSheet key={m.id} a={m.act} />
        ))}
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

  if (dir.loading) return <p className="muted">Загрузка…</p>;
  if (dir.error) return <p className="error">Не удалось загрузить данные: {dir.error}</p>;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'balance', label: 'Баланс' },
    { id: 'payment', label: 'Оплата' },
    { id: 'invoice', label: 'Акт ученика' },
    { id: 'group', label: 'Акты группы' },
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
          ym={ym}
          onPay={(id) => {
            setStudentId(id);
            setTab('payment');
          }}
        />
      )}
      {tab === 'payment' && <PaymentTab studentId={studentId} onPick={setStudentId} />}
      {tab === 'invoice' && <InvoiceTab studentId={studentId} onPick={setStudentId} ym={ym} />}
      {tab === 'group' && (
        <GroupTab
          ym={ym}
          onOpen={(id) => {
            setStudentId(id);
            setTab('invoice');
          }}
        />
      )}
    </div>
  );
}
