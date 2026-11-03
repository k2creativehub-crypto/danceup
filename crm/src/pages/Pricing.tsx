import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import {
  WEEKDAY_NAMES,
  formatDate,
  formatMoney,
  parseMoney,
  scheduleLabels,
  timeHM,
  todayMinsk,
} from '../lib/format';
import type { ScheduleSlot } from '../lib/format';
import { useDirectory } from '../lib/store';
import type { DirGroup } from '../lib/store';

type PriceKind = 'regular' | 'single';

interface PriceRow {
  id: string;
  group_id: string;
  kind: PriceKind;
  price_kopecks: number;
  valid_from: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

function sortSlots(slots: ScheduleSlot[]): ScheduleSlot[] {
  return [...slots].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
}

// ---------- Цена ----------

function PriceBlock({
  group,
  kind,
  title,
  hint,
  rows,
  onChanged,
}: {
  group: DirGroup;
  kind: PriceKind;
  title: string;
  hint: string;
  rows: PriceRow[];
  onChanged: () => Promise<void>;
}) {
  const today = todayMinsk();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // rows отсортированы по valid_from от новых к старым
  const current = rows.find((r) => r.valid_from <= today) ?? null;
  const upcoming = rows.filter((r) => r.valid_from > today).sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  const open = () => {
    setAmount(current ? String(current.price_kopecks / 100).replace('.', ',') : '');
    setFrom(today);
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    const kopecks = parseMoney(amount);
    if (kopecks === null) return setErr('Введите цену числом, например 25 или 25,50');
    if (!from) return setErr('Укажите, с какой даты действует цена');

    const sameDate = rows.find((r) => r.valid_from === from);
    if (sameDate && sameDate.price_kopecks === kopecks) return setErr('На эту дату уже стоит такая цена');
    if (
      sameDate &&
      !window.confirm(
        `На ${formatDate(from)} уже задана цена ${formatMoney(sameDate.price_kopecks)}. Заменить её на ${formatMoney(kopecks)}?`,
      )
    )
      return;
    if (
      from < today &&
      !window.confirm(
        'Дата в прошлом: новая цена применится и к уже прошедшим занятиям, и счета за них изменятся. Продолжить?',
      )
    )
      return;

    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from('group_prices')
      .upsert({ group_id: group.id, kind, price_kopecks: kopecks, valid_from: from }, { onConflict: 'group_id,kind,valid_from' });
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    await onChanged();
    setBusy(false);
    setEditing(false);
  };

  return (
    <div className="pricing-section">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      {current ? (
        <p>
          <strong>{formatMoney(current.price_kopecks)}</strong>
          <span className="muted"> · действует с {formatDate(current.valid_from)}</span>
        </p>
      ) : (
        <p className="muted">Цена не задана.</p>
      )}
      {upcoming.map((r) => (
        <p key={r.id} className="small">
          С {formatDate(r.valid_from)}: <strong>{formatMoney(r.price_kopecks)}</strong>
        </p>
      ))}

      {!editing ? (
        <button type="button" className="btn btn-sm" onClick={open}>
          {current || upcoming.length > 0 ? 'Изменить цену' : 'Задать цену'}
        </button>
      ) : (
        <div className="inline-form">
          <label className="field">
            <span>Цена одного занятия, BYN</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25,00"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Действует с</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="field-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {rows.length > 1 && (
        <details className="price-history">
          <summary>История цен ({rows.length})</summary>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                с {formatDate(r.valid_from)}: {formatMoney(r.price_kopecks)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------- Расписание ----------

interface SlotDraft {
  weekday: string;
  start: string;
  end: string;
  location: string;
}

function SlotForm({
  group,
  slot,
  locations,
  onDone,
  onCancel,
}: {
  group: DirGroup;
  slot: ScheduleSlot | null;
  locations: string[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<SlotDraft>({
    weekday: slot ? String(slot.weekday) : '1',
    start: slot ? timeHM(slot.start_time) : '',
    end: slot ? timeHM(slot.end_time) : '',
    location: slot?.location ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listId = `loc-${group.id}`;

  const save = async () => {
    if (!d.start) return setErr('Укажите время начала');
    if (d.end && d.end <= d.start) return setErr('Время окончания должно быть позже времени начала');
    const row = {
      weekday: Number(d.weekday),
      start_time: d.start,
      end_time: d.end || null,
      location: d.location.trim() || null,
    };
    setBusy(true);
    setErr(null);
    const res = slot
      ? await supabase.from('group_schedule').update(row).eq('id', slot.id).select('id')
      : await supabase.from('group_schedule').insert({ group_id: group.id, ...row }).select('id');
    if (res.error) {
      setBusy(false);
      return setErr(
        res.error.code === '23505'
          ? 'Такое занятие (день и время начала) уже есть в расписании этой группы'
          : res.error.message,
      );
    }
    if (!res.data || res.data.length === 0) {
      setBusy(false);
      return setErr('Не удалось сохранить: нет прав или запись не найдена');
    }
    await onDone();
    setBusy(false);
  };

  return (
    <div className="inline-form slot-form">
      <div className="slot-grid">
        <label className="field">
          <span>День недели</span>
          <select value={d.weekday} onChange={(e) => setD({ ...d, weekday: e.target.value })}>
            {WEEKDAY_NAMES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Начало</span>
          <input type="time" value={d.start} onChange={(e) => setD({ ...d, start: e.target.value })} />
        </label>
        <label className="field">
          <span>Окончание (необязательно)</span>
          <input type="time" value={d.end} onChange={(e) => setD({ ...d, end: e.target.value })} />
        </label>
        <label className="field">
          <span>Место (необязательно)</span>
          <input
            list={listId}
            value={d.location}
            onChange={(e) => setD({ ...d, location: e.target.value })}
            placeholder="Например, зал 1"
          />
          <datalist id={listId}>
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="field-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function ScheduleBlock({ group, slots, locations }: { group: DirGroup; slots: ScheduleSlot[]; locations: string[] }) {
  const dir = useDirectory();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sorted = sortSlots(slots);
  const labels = scheduleLabels(sorted);

  const done = async () => {
    await dir.refresh(['slots']);
    setEditingId(null);
  };

  const remove = async (s: ScheduleSlot, label: string) => {
    if (!window.confirm(`Удалить занятие «${label}» из расписания группы?`)) return;
    setErr(null);
    const { data, error } = await supabase.from('group_schedule').delete().eq('id', s.id).select('id');
    if (error) return setErr(error.message);
    if (!data || data.length === 0) return setErr('Не удалось удалить: нет прав или запись не найдена');
    await dir.refresh(['slots']);
  };

  return (
    <div className="pricing-section">
      <h3>Расписание</h3>
      {sorted.length === 0 && editingId !== 'new' && <p className="muted">Расписание не задано.</p>}
      {sorted.map((s, i) =>
        editingId === s.id ? (
          <SlotForm key={s.id} group={group} slot={s} locations={locations} onDone={done} onCancel={() => setEditingId(null)} />
        ) : (
          <div key={s.id} className="slot-row">
            <div>
              <strong>{labels[i]}</strong>
              {s.location && <span className="muted"> · {s.location}</span>}
            </div>
            <div className="slot-actions">
              <button type="button" className="btn btn-sm" onClick={() => setEditingId(s.id)}>
                Изменить
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(s, labels[i])}>
                Удалить
              </button>
            </div>
          </div>
        ),
      )}
      {err && <p className="error">{err}</p>}
      {editingId === 'new' ? (
        <SlotForm group={group} slot={null} locations={locations} onDone={done} onCancel={() => setEditingId(null)} />
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setEditingId('new')}>
          + Добавить занятие
        </button>
      )}
    </div>
  );
}

// ---------- Страница ----------

export default function Pricing() {
  const { groups, slotsByGroup, slots, loading, error } = useDirectory();
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [pricesError, setPricesError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'no-schedule' | 'no-price'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadPrices = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('group_prices')
      .select('id, group_id, kind, price_kopecks, valid_from')
      .order('valid_from', { ascending: false })
      .limit(5000);
    if (e) return setPricesError(e.message);
    setPricesError(null);
    setPrices((data ?? []) as PriceRow[]);
  }, []);

  useEffect(() => {
    void loadPrices();
  }, [loadPrices]);

  const pricesByGroup = useMemo(() => {
    const m = new Map<string, PriceRow[]>();
    for (const p of prices ?? []) {
      const list = m.get(p.group_id);
      if (list) list.push(p);
      else m.set(p.group_id, [p]);
    }
    return m;
  }, [prices]);

  const locations = useMemo(
    () => Array.from(new Set(slots.map((s) => s.location?.trim()).filter((x): x is string => !!x))).sort(byName),
    [slots],
  );

  const today = todayMinsk();
  const regularRows = (gid: string) => (pricesByGroup.get(gid) ?? []).filter((r) => r.kind === 'regular');
  const singleRows = (gid: string) => (pricesByGroup.get(gid) ?? []).filter((r) => r.kind === 'single');
  const hasPrice = (gid: string) => regularRows(gid).some((r) => r.valid_from <= today);

  const visible = useMemo(() => groups.filter((g) => showArchived || !g.is_archived), [groups, showArchived]);
  const noSchedule = visible.filter((g) => (slotsByGroup.get(g.id) ?? []).length === 0).length;
  const noPrice = prices ? visible.filter((g) => !hasPrice(g.id)).length : null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible
      .filter((g) => !q || g.name.toLowerCase().includes(q) || (g.teacher?.full_name ?? '').toLowerCase().includes(q))
      .filter((g) => {
        if (show === 'no-schedule') return (slotsByGroup.get(g.id) ?? []).length === 0;
        if (show === 'no-price') return !hasPrice(g.id);
        return true;
      })
      .sort((a, b) => byName(a.name, b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, query, show, slotsByGroup, pricesByGroup]);

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить данные: {error}</p>;

  return (
    <div className="pricing-page">
      <h1>Цены и расписание</h1>
      <p className="muted small">
        Цена задаётся за одно занятие и действует с выбранной даты. Старые цены сохраняются: по ним считаются счета за
        прошедшие занятия.
      </p>
      {pricesError && <p className="error">Не удалось загрузить цены: {pricesError}</p>}

      <div className="filters filters-pricing">
        <input
          className="search"
          type="search"
          placeholder="Поиск: название или преподаватель"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="all">Все группы</option>
          <option value="no-schedule">Без расписания ({noSchedule})</option>
          <option value="no-price">Без цены{noPrice !== null ? ` (${noPrice})` : ''}</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Показать архивные
        </label>
      </div>

      <p className="muted count">Групп: {rows.length}</p>
      {rows.length === 0 && <p className="muted">Групп не найдено.</p>}

      <div className="pricing-list">
        {rows.map((g) => {
          const gSlots = slotsByGroup.get(g.id) ?? [];
          const labels = scheduleLabels(sortSlots(gSlots));
          const current = regularRows(g.id).find((r) => r.valid_from <= today) ?? null;
          const currentSingle = singleRows(g.id).find((r) => r.valid_from <= today) ?? null;
          const isOpen = openId === g.id;
          return (
            <div
              key={g.id}
              id={`pricing-${g.id}`}
              className={`pricing-item${isOpen ? ' is-open' : ''}${g.is_archived ? ' is-archived' : ''}`}
            >
              <button type="button" className="pricing-head" onClick={() => setOpenId(isOpen ? null : g.id)} aria-expanded={isOpen}>
                <span className="pricing-title">
                  {g.name}
                  {g.is_archived && <span className="badge">архив</span>}
                  <span className="muted pricing-teacher"> · {g.teacher?.full_name ?? 'преподаватель не указан'}</span>
                </span>
                <span className="pricing-summary">
                  <span className={labels.length === 0 ? 'warn' : ''}>
                    {labels.length > 0 ? labels.join(' · ') : 'расписание не задано'}
                  </span>
                  <span className={current ? '' : 'warn'}>
                    {prices === null
                      ? '…'
                      : current
                        ? `${formatMoney(current.price_kopecks)}${currentSingle ? ` · разовое ${formatMoney(currentSingle.price_kopecks)}` : ''}`
                        : 'цена не задана'}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="pricing-body">
                  {prices === null ? (
                    <span className="skeleton skeleton-line" style={{ width: '40%' }} />
                  ) : (
                    <>
                      <PriceBlock
                        group={g}
                        kind="regular"
                        title="Регулярное занятие"
                        hint="Цена занятия в абонементе. По ней считается счёт за месяц."
                        rows={regularRows(g.id)}
                        onChanged={loadPrices}
                      />
                      <PriceBlock
                        group={g}
                        kind="single"
                        title="Разовое занятие"
                        hint="Нужна, если «б» (болезнь) оплачивается по разовой цене."
                        rows={singleRows(g.id)}
                        onChanged={loadPrices}
                      />
                    </>
                  )}
                  <ScheduleBlock group={g} slots={gSlots} locations={locations} />
                  <div className="pricing-done">
                    <button
                      type="button"
                      className="done-btn"
                      title="Свернуть"
                      aria-label="Свернуть"
                      onClick={() => {
                        setOpenId(null);
                        setTimeout(
                          () => document.getElementById(`pricing-${g.id}`)?.scrollIntoView({ block: 'nearest' }),
                          0,
                        );
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
