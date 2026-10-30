import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import EditableField from '../components/EditableField';
import type { Option } from '../components/EditableField';
import StudentSearch from '../components/StudentSearch';
import { updateRow } from '../lib/db';
import { ageYears, formatDate, formatPhone, pluralStudents, pluralYears, scheduleLabels, todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';
import type { DirEnrollment, DirGroup, DirStatus, DirStudent } from '../lib/store';

const STATUS_OPTIONS: Option[] = [
  { value: 'active', label: 'Занимается' },
  { value: 'reserve', label: 'Резерв' },
  { value: 'left', label: 'Выбыл' },
];
const STATUS_LABEL: Record<string, string> = { active: 'Занимается', reserve: 'Резерв', left: 'Выбыл' };
const PRIMARY_OPTIONS: Option[] = [
  { value: 'true', label: 'Основная группа' },
  { value: 'false', label: 'Дополнительная группа' },
];
const SECTIONS: { status: DirStatus; title: string }[] = [
  { status: 'active', title: 'Занимаются' },
  { status: 'reserve', title: 'Резерв' },
  { status: 'left', title: 'Выбыли' },
];

const byName = (a: string, b: string) => a.localeCompare(b, 'ru');

function AddStudent({ group, enrolledIds }: { group: DirGroup; enrolledIds: Set<string> }) {
  const dir = useDirectory();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DirStudent | null>(null);
  const [isPrimary, setIsPrimary] = useState('true');
  const [status, setStatus] = useState<DirStatus>('active');
  const [startDate, setStartDate] = useState(todayMinsk());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setErr(null);
  };

  const pick = (s: DirStudent) => {
    // Если ученик уже занимается где-то в основной группе, новая для него по умолчанию дополнительная.
    const hasPrimary = (dir.enrollmentsByStudent.get(s.id) ?? []).some((e) => e.status === 'active' && e.is_primary);
    setIsPrimary(hasPrimary ? 'false' : 'true');
    setPicked(s);
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
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    await dir.refresh(['enrollments']);
    setBusy(false);
    close();
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Добавить ученика
      </button>
    );
  }

  return (
    <div className="panel add-panel">
      <h2>Добавить ученика в группу</h2>
      {!picked ? (
        <>
          <StudentSearch students={dir.students} excludeIds={enrolledIds} onPick={pick} autoFocus />
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
            <select value={status} onChange={(e) => setStatus(e.target.value as DirStatus)}>
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

function RosterRow({ enr, student, isAdmin }: { enr: DirEnrollment; student: DirStudent | undefined; isAdmin: boolean }) {
  const dir = useDirectory();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const age = student ? ageYears(student.birth_date) : null;
  const phone = student?.phone ?? student?.guardian?.phone ?? null;

  const save =
    (field: string, convert?: (v: string | null) => unknown) =>
    async (v: string | null) => {
      const value = convert ? convert(v) : v;
      const e = await updateRow('enrollments', enr.id, { [field]: value });
      if (!e) dir.patch('enrollments', enr.id, { [field]: value });
      return e;
    };

  const markLeft = async () => {
    if (!window.confirm('Отметить ученика как выбывшего с сегодняшнего дня? История посещений сохранится.')) return;
    setBusy(true);
    setErr(null);
    const fields = { status: 'left', end_date: todayMinsk() };
    const e = await updateRow('enrollments', enr.id, fields);
    setBusy(false);
    if (e) return setErr(e);
    dir.patch('enrollments', enr.id, fields);
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
    dir.removeEnrollment(enr.id);
  };

  return (
    <div className={`roster-item${enr.status === 'left' ? ' is-left' : ''}`}>
      <div className="roster-row">
        <div className="roster-name">
          <Link to={`/students/${enr.student_id}`}>{student?.full_name ?? 'Ученик'}</Link>
          {!enr.is_primary && <span className="badge badge-extra">доп. группа</span>}
        </div>
        <div className="muted roster-age">{age !== null ? pluralYears(age) : student?.birth_date_raw ?? '—'}</div>
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
            display={(v) => (v ? STATUS_LABEL[v] ?? v : null)}
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
            display={(v) => (v === 'true' ? 'Основная группа' : v === 'false' ? 'Дополнительная группа' : null)}
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
  const dir = useDirectory();
  const isAdmin = profile?.role === 'admin';
  const [archiveErr, setArchiveErr] = useState<string | null>(null);

  const group = id ? dir.groupById.get(id) : undefined;
  const enrs = useMemo(() => (id ? dir.enrollmentsByGroup.get(id) ?? [] : []), [dir.enrollmentsByGroup, id]);
  const slots = useMemo(() => (id ? dir.slotsByGroup.get(id) ?? [] : []), [dir.slotsByGroup, id]);
  const enrolledIds = useMemo(() => new Set(enrs.map((e) => e.student_id)), [enrs]);
  const teacherOptions: Option[] = useMemo(
    () => dir.teachers.map((t) => ({ value: t.id, label: t.full_name })),
    [dir.teachers],
  );

  const back = () => navigate('/groups');

  if (dir.error) return <p className="error">Не удалось загрузить группу: {dir.error}</p>;
  if (dir.loading) {
    return (
      <div className="card-page group-page">
        <button className="btn btn-sm back-btn" onClick={back}>
          ← К списку групп
        </button>
        <span className="skeleton skeleton-title" />
        <div className="panel">
          <span className="skeleton skeleton-line" style={{ width: '40%' }} />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      </div>
    );
  }
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
  const sortedSlots = [...slots].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  const labels = scheduleLabels(sortedSlots);

  const saveName = async (v: string | null) => {
    const err = await updateRow('groups', g.id, { name: v });
    if (!err) dir.patch('groups', g.id, { name: v });
    return err;
  };

  const saveTeacher = async (v: string | null) => {
    const err = await updateRow('groups', g.id, { teacher_id: v });
    if (!err) {
      const t = dir.teachers.find((x) => x.id === v);
      dir.patch('groups', g.id, { teacher_id: v, teacher: t ? { full_name: t.full_name } : null });
    }
    return err;
  };

  const toggleArchive = async () => {
    const next = !g.is_archived;
    if (next && !window.confirm('Отправить группу в архив? Она пропадёт из обычного списка, данные сохранятся.')) return;
    setArchiveErr(null);
    const err = await updateRow('groups', g.id, { is_archived: next });
    if (err) setArchiveErr(err);
    else dir.patch('groups', g.id, { is_archived: next });
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
        <EditableField label="Название" value={g.name} required canEdit={isAdmin} onSave={saveName} />
        <EditableField
          label="Преподаватель"
          kind="select"
          options={teacherOptions}
          value={g.teacher_id}
          required
          canEdit={isAdmin}
          display={() => g.teacher?.full_name ?? null}
          onSave={saveTeacher}
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
        {sortedSlots.length === 0 ? (
          <p className="muted">Расписание не задано.</p>
        ) : (
          <ul className="schedule-list">
            {sortedSlots.map((s, i) => (
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
        {isAdmin && <AddStudent group={g} enrolledIds={enrolledIds} />}
      </div>

      {enrs.length === 0 && <p className="muted">В группе пока нет учеников.</p>}

      {SECTIONS.map(({ status, title }) => {
        const list = enrs
          .filter((e) => e.status === status)
          .sort((a, b) =>
            byName(dir.studentById.get(a.student_id)?.full_name ?? '', dir.studentById.get(b.student_id)?.full_name ?? ''),
          );
        if (list.length === 0) return null;
        return (
          <section key={status} className="roster">
            <h3 className="roster-title">
              {title} <span className="muted">· {list.length}</span>
            </h3>
            {list.map((e) => (
              <RosterRow key={e.id} enr={e} student={dir.studentById.get(e.student_id)} isAdmin={isAdmin} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
