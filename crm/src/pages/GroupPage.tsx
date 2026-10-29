import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import EditableField from '../components/EditableField';
import type { Option } from '../components/EditableField';
import { updateRow } from '../lib/db';
import {
  ageYears,
  formatDate,
  formatPhone,
  pluralStudents,
  pluralYears,
  scheduleLabels,
  todayMinsk,
} from '../lib/format';
import type { ScheduleSlot } from '../lib/format';

type Status = 'active' | 'reserve' | 'left';

interface GroupRow {
  id: string;
  name: string;
  season: string;
  teacher_id: string | null;
  is_archived: boolean;
  teacher: { full_name: string } | null;
}
interface Enr {
  id: string;
  student_id: string;
  is_primary: boolean;
  status: Status;
  start_date: string | null;
  end_date: string | null;
}
interface Stu {
  id: string;
  full_name: string;
  birth_date: string | null;
  birth_date_raw: string | null;
  phone: string | null;
  guardian: { full_name: string | null; phone: string | null } | null;
}
interface PickStudent {
  id: string;
  full_name: string;
  birth_date: string | null;
}

const STATUS_OPTIONS: Option[] = [
  { value: 'active', label: 'Занимается' },
  { value: 'reserve', label: 'Резерв' },
  { value: 'left', label: 'Выбыл' },
];
const PRIMARY_OPTIONS: Option[] = [
  { value: 'true', label: 'Основная группа' },
  { value: 'false', label: 'Дополнительная группа' },
];
const SECTIONS: { status: Status; title: string }[] = [
  { status: 'active', title: 'Занимаются' },
  { status: 'reserve', title: 'Резерв' },
  { status: 'left', title: 'Выбыли' },
];

const byName = (a: string, b: string) => a.localeCompare(b, 'ru');

function AddStudent({
  group,
  enrolledIds,
  onDone,
}: {
  group: GroupRow;
  enrolledIds: Set<string>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<PickStudent[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickStudent | null>(null);
  const [isPrimary, setIsPrimary] = useState('true');
  const [status, setStatus] = useState<Status>('active');
  const [startDate, setStartDate] = useState(todayMinsk());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Список всех учеников грузим только когда админ нажал «Добавить ученика».
  useEffect(() => {
    if (!open || all) return;
    let cancelled = false;
    supabase
      .from('students')
      .select('id, full_name, birth_date')
      .limit(5000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setLoadErr(error.message);
        else setAll((data ?? []) as PickStudent[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, all]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!all || q.length < 2) return [];
    return all
      .filter((s) => !enrolledIds.has(s.id) && s.full_name.toLowerCase().includes(q))
      .sort((a, b) => byName(a.full_name, b.full_name))
      .slice(0, 8);
  }, [all, query, enrolledIds]);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setQuery('');
    setErr(null);
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('enrollments').insert({
      id: crypto.randomUUID(),
      student_id: picked.id,
      group_id: group.id,
      season: group.season,
      is_primary: isPrimary === 'true',
      status,
      start_date: startDate || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    close();
    onDone();
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Добавить ученика
      </button>
    );
  }

  return (
    <div className="panel">
      <h2>Добавить ученика в группу</h2>
      {!picked ? (
        <>
          <input
            className="search"
            type="search"
            placeholder="Начните вводить ФИО (от 2 букв)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loadErr && <p className="error">Не удалось загрузить учеников: {loadErr}</p>}
          {!all && !loadErr && <p className="muted small">Загружаем список учеников…</p>}
          {all && query.trim().length >= 2 && matches.length === 0 && (
            <p className="muted small">Не найдено. Ученики, которые уже есть в этой группе, в поиске не показываются.</p>
          )}
          <div className="pick-list">
            {matches.map((s) => {
              const age = ageYears(s.birth_date);
              return (
                <button type="button" key={s.id} className="pick-item" onClick={() => setPicked(s)}>
                  <span>{s.full_name}</span>
                  <span className="muted">{age !== null ? pluralYears(age) : 'возраст не указан'}</span>
                </button>
              );
            })}
          </div>
          <div className="field-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-sm" onClick={close}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            <strong>{picked.full_name}</strong>
          </p>
          <label className="field">
            <span>Тип группы</span>
            <select value={isPrimary} onChange={(e) => setIsPrimary(e.target.value)}>
              {PRIMARY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Статус</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Начало занятий</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="field-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? 'Добавляем…' : 'Добавить'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setPicked(null)} disabled={busy}>
              Назад
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RosterRow({
  enr,
  student,
  isAdmin,
  onChanged,
}: {
  enr: Enr;
  student: Stu | undefined;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const age = student ? ageYears(student.birth_date) : null;
  const phone = student?.phone ?? student?.guardian?.phone ?? null;

  const save =
    (field: string, convert?: (v: string | null) => unknown) =>
    async (v: string | null) => {
      const e = await updateRow('enrollments', enr.id, { [field]: convert ? convert(v) : v });
      if (!e) onChanged();
      return e;
    };

  const markLeft = async () => {
    if (!window.confirm('Отметить ученика как выбывшего с сегодняшнего дня? История посещений сохранится.')) return;
    setBusy(true);
    setErr(null);
    const e = await updateRow('enrollments', enr.id, { status: 'left', end_date: todayMinsk() });
    setBusy(false);
    if (e) return setErr(e);
    onChanged();
  };

  const remove = async () => {
    if (
      !window.confirm(
        'Удалить зачисление совсем? Это нужно только при ошибочной записи. Если ученик просто ушёл, используйте «Выбыл».',
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.from('enrollments').delete().eq('id', enr.id).select('id');
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data || data.length === 0) return setErr('Не удалось удалить: нет прав или запись не найдена');
    onChanged();
  };

  return (
    <div className={`roster-item${enr.status === 'left' ? ' is-left' : ''}`}>
      <div className="roster-row">
        <div className="roster-name">
          <Link to={`/students/${enr.student_id}`}>{student?.full_name ?? 'Ученик'}</Link>
          {!enr.is_primary && <span className="badge badge-extra">доп. группа</span>}
        </div>
        <div className="muted roster-age">
          {age !== null ? pluralYears(age) : student?.birth_date_raw ?? '—'}
        </div>
        <div className="roster-phone">
          {phone ? <a href={`tel:${phone}`}>{formatPhone(phone)}</a> : <span className="muted">нет телефона</span>}
        </div>
        <div className="muted roster-dates">
          {enr.start_date ? `с ${formatDate(enr.start_date)}` : ''}
          {enr.end_date ? ` до ${formatDate(enr.end_date)}` : ''}
        </div>
        <div className="roster-actions">
          <Link className="btn btn-sm" to={`/students/${enr.student_id}`}>
            Открыть
          </Link>
          {isAdmin && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing((x) => !x)}>
              {editing ? 'Свернуть' : 'Изменить'}
            </button>
          )}
        </div>
      </div>

      {isAdmin && editing && (
        <div className="roster-edit">
          <EditableField
            label="Статус"
            kind="select"
            options={STATUS_OPTIONS}
            value={enr.status}
            required
            canEdit
            hint={
              enr.status === 'left' && !enr.end_date
                ? 'Укажите дату окончания: пока её нет, посещаемость для этого ученика отмечать нельзя.'
                : undefined
            }
            onSave={save('status')}
          />
          <EditableField
            label="Тип группы"
            kind="select"
            options={PRIMARY_OPTIONS}
            value={enr.is_primary ? 'true' : 'false'}
            required
            canEdit
            onSave={save('is_primary', (v) => v === 'true')}
          />
          <EditableField
            label="Начало занятий"
            kind="date"
            value={enr.start_date}
            canEdit
            display={(v) => (v ? formatDate(v) : null)}
            onSave={save('start_date')}
          />
          <EditableField
            label="Окончание занятий"
            kind="date"
            value={enr.end_date}
            canEdit
            display={(v) => (v ? formatDate(v) : null)}
            onSave={save('end_date')}
          />
          {err && <div className="error">{err}</div>}
          <div className="field-actions" style={{ marginTop: 8 }}>
            {enr.status !== 'left' && (
              <button type="button" className="btn btn-sm" onClick={markLeft} disabled={busy}>
                Убрать из группы (выбыл)
              </button>
            )}
            <button type="button" className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>
              Удалить зачисление
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [enrs, setEnrs] = useState<Enr[]>([]);
  const [students, setStudents] = useState<Map<string, Stu>>(new Map());
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [archiveErr, setArchiveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [gr, sc, en, te] = await Promise.all([
        supabase
          .from('groups')
          .select('id, name, season, teacher_id, is_archived, teacher:teachers(full_name)')
          .eq('id', id)
          .maybeSingle(),
        supabase.from('group_schedule').select('group_id, weekday, start_time, end_time, location').eq('group_id', id),
        supabase
          .from('enrollments_v')
          .select('id, student_id, is_primary, status, start_date, end_date')
          .eq('group_id', id),
        isAdmin
          ? supabase.from('teachers').select('id, full_name').limit(500)
          : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
      ]);
      if (cancelled) return;
      const firstError = gr.error ?? sc.error ?? en.error ?? te.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      const enrList = (en.data ?? []) as unknown as Enr[];
      const ids = enrList.map((e) => e.student_id);
      const stuMap = new Map<string, Stu>();
      if (ids.length > 0) {
        const st = await supabase
          .from('students')
          .select('id, full_name, birth_date, birth_date_raw, phone, guardian:guardians(full_name, phone)')
          .in('id', ids);
        if (cancelled) return;
        if (st.error) {
          setError(st.error.message);
          setLoading(false);
          return;
        }
        for (const s of (st.data ?? []) as unknown as Stu[]) stuMap.set(s.id, s);
      }
      setGroup((gr.data ?? null) as unknown as GroupRow | null);
      setSlots((sc.data ?? []) as unknown as ScheduleSlot[]);
      setEnrs(enrList);
      setStudents(stuMap);
      setTeachers(
        ((te.data ?? []) as { id: string; full_name: string }[])
          .sort((a, b) => byName(a.full_name, b.full_name))
          .map((t) => ({ value: t.id, label: t.full_name })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAdmin, version]);

  const enrolledIds = useMemo(() => new Set(enrs.map((e) => e.student_id)), [enrs]);

  const back = () => navigate('/groups');

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить группу: {error}</p>;
  if (!group) {
    return (
      <div>
        <button className="btn btn-sm" onClick={back}>
          ← К списку групп
        </button>
        <p className="muted" style={{ marginTop: 16 }}>
          Группа не найдена или нет доступа.
        </p>
      </div>
    );
  }

  const g = group;
  const activeCount = enrs.filter((e) => e.status === 'active').length;
  const labels = scheduleLabels(slots);

  const saveGroup = (field: string) => async (v: string | null) => {
    const err = await updateRow('groups', g.id, { [field]: v });
    if (!err) reload();
    return err;
  };

  const toggleArchive = async () => {
    const next = !g.is_archived;
    if (next && !window.confirm('Отправить группу в архив? Она пропадёт из обычного списка, данные сохранятся.')) return;
    setArchiveErr(null);
    const err = await updateRow('groups', g.id, { is_archived: next });
    if (err) setArchiveErr(err);
    else reload();
  };

  return (
    <div className="card-page group-page">
      <button className="btn btn-sm back-btn" onClick={back}>
        ← К списку групп
      </button>

      <h1>
        {g.name}
        {g.is_archived && <span className="badge">архив</span>}
      </h1>
      <p className="muted subtitle">
        {g.teacher?.full_name ?? 'преподаватель не указан'} · сезон {g.season} · {pluralStudents(activeCount)}
        {!isAdmin && ' · просмотр'}
      </p>

      <section className="panel">
        <h2>Группа</h2>
        <EditableField label="Название" value={g.name} required canEdit={isAdmin} onSave={saveGroup('name')} />
        <EditableField
          label="Преподаватель"
          kind="select"
          options={teachers}
          value={g.teacher_id}
          required
          canEdit={isAdmin}
          display={() => g.teacher?.full_name ?? null}
          onSave={saveGroup('teacher_id')}
        />
        <EditableField label="Сезон" value={g.season} canEdit={false} onSave={async () => null} />
        {isAdmin && (
          <div className="field-row">
            <div className="field-label">Архив</div>
            <div className="field-body">
              <button type="button" className="btn btn-sm" onClick={toggleArchive}>
                {g.is_archived ? 'Вернуть из архива' : 'Отправить в архив'}
              </button>
            </div>
            {archiveErr && <div className="error field-error">{archiveErr}</div>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Расписание</h2>
        {slots.length === 0 ? (
          <p className="muted">Расписание не задано.</p>
        ) : (
          <ul className="schedule-list">
            {[...slots]
              .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
              .map((s, i) => (
                <li key={`${s.weekday}-${s.start_time}`}>
                  <strong>{labels[i]}</strong>
                  {s.location && <span className="muted"> · {s.location}</span>}
                </li>
              ))}
          </ul>
        )}
        {isAdmin && <p className="muted small">Расписание группы составляется в разделе «Цены и расписание».</p>}
      </section>

      <div className="section-head">
        <h2 className="section-title">Состав группы</h2>
        {isAdmin && <AddStudent group={g} enrolledIds={enrolledIds} onDone={reload} />}
      </div>

      {enrs.length === 0 && <p className="muted">В группе пока нет учеников.</p>}

      {SECTIONS.map(({ status, title }) => {
        const list = enrs
          .filter((e) => e.status === status)
          .sort((a, b) => byName(students.get(a.student_id)?.full_name ?? '', students.get(b.student_id)?.full_name ?? ''));
        if (list.length === 0) return null;
        return (
          <section key={status} className="roster">
            <h3 className="roster-title">
              {title} <span className="muted">· {list.length}</span>
            </h3>
            {list.map((e) => (
              <RosterRow key={e.id} enr={e} student={students.get(e.student_id)} isAdmin={isAdmin} onChanged={reload} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
