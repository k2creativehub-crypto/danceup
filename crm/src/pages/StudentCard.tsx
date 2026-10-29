import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import EditableField from '../components/EditableField';
import type { Option } from '../components/EditableField';
import { updateRow } from '../lib/db';
import { PHONE_HINT, normalizePhone } from '../lib/phone';
import { ageYears, formatDate, formatPhone, pluralYears } from '../lib/format';

interface Guardian {
  id: string;
  full_name: string | null;
  phone: string | null;
  phone_raw: string | null;
  email: string | null;
}
interface StudentRow {
  id: string;
  full_name: string;
  birth_date: string | null;
  birth_date_raw: string | null;
  phone: string | null;
  guardian_id: string | null;
  guardian: Guardian | null;
}
interface Enr {
  id: string;
  group_id: string;
  season: string;
  is_primary: boolean;
  status: 'active' | 'reserve' | 'left';
  start_date: string | null;
  end_date: string | null;
  trial_date: string | null;
  trial_note: string | null;
  contract_number: string | null;
  contract_date: string | null;
  notes: string | null;
}
interface GroupRow {
  id: string;
  name: string;
  teacher: { full_name: string } | null;
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

function AddGuardian({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    const p = phone.trim();
    if (!n && !p) {
      setErr('Укажите имя или телефон');
      return;
    }
    let normalized: string | null = null;
    if (p) {
      normalized = normalizePhone(p);
      if (!normalized) {
        setErr(PHONE_HINT);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    const gid = crypto.randomUUID();
    const ins = await supabase
      .from('guardians')
      .insert({ id: gid, full_name: n || null, phone: normalized, phone_raw: p || null });
    if (ins.error) {
      setErr(ins.error.message);
      setBusy(false);
      return;
    }
    const e2 = await updateRow('students', studentId, { guardian_id: gid });
    setBusy(false);
    if (e2) {
      setErr(e2);
      return;
    }
    onDone();
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        Добавить родителя
      </button>
    );
  }
  return (
    <div className="field-edit">
      <input placeholder="ФИО или имя родителя" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="tel" placeholder="+375291234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <div className="field-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function StudentCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [student, setStudent] = useState<StudentRow | null>(null);
  const [enrollments, setEnrollments] = useState<Enr[]>([]);
  const [groups, setGroups] = useState<Map<string, GroupRow>>(new Map());
  const [siblings, setSiblings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [st, en, gr] = await Promise.all([
        supabase
          .from('students')
          .select(
            'id, full_name, birth_date, birth_date_raw, phone, guardian_id, guardian:guardians(id, full_name, phone, phone_raw, email)',
          )
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('enrollments_v')
          .select(
            'id, group_id, season, is_primary, status, start_date, end_date, trial_date, trial_note, contract_number, contract_date, notes',
          )
          .eq('student_id', id),
        supabase.from('groups').select('id, name, teacher:teachers(full_name)').limit(1000),
      ]);
      if (cancelled) return;
      const firstError = st.error ?? en.error ?? gr.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      const s = (st.data ?? null) as unknown as StudentRow | null;
      setStudent(s);
      setEnrollments((en.data ?? []) as unknown as Enr[]);
      const gm = new Map<string, GroupRow>();
      for (const g of (gr.data ?? []) as unknown as GroupRow[]) gm.set(g.id, g);
      setGroups(gm);

      if (s?.guardian_id) {
        const cnt = await supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('guardian_id', s.guardian_id);
        if (!cancelled) setSiblings(cnt.count ?? 0);
      } else {
        setSiblings(0);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/crm');
  };

  if (loading) return <p className="muted">Загрузка…</p>;
  if (error) return <p className="error">Не удалось загрузить карточку: {error}</p>;
  if (!student) {
    return (
      <div>
        <button className="btn btn-sm" onClick={back}>← К списку</button>
        <p className="muted" style={{ marginTop: 16 }}>Ученик не найден или нет доступа.</p>
      </div>
    );
  }

  const s = student;
  const g = s.guardian;
  const age = ageYears(s.birth_date);

  const saveStudent = (field: string, extra?: (v: string | null) => Record<string, unknown>) =>
    async (v: string | null) => {
      const err = await updateRow('students', s.id, { [field]: v, ...(extra ? extra(v) : {}) });
      if (!err) reload();
      return err;
    };

  const savePhone = (table: 'students' | 'guardians', rowId: string, field: string) =>
    async (v: string | null) => {
      let value: string | null = null;
      if (v !== null) {
        value = normalizePhone(v);
        if (!value) return PHONE_HINT;
      }
      const err = await updateRow(table, rowId, { [field]: value });
      if (!err) reload();
      return err;
    };

  const saveGuardian = (field: string) => async (v: string | null) => {
    if (!g) return 'Родитель не найден';
    const err = await updateRow('guardians', g.id, { [field]: v });
    if (!err) reload();
    return err;
  };

  const saveEnrollment = (enrId: string, field: string, convert?: (v: string | null) => unknown) =>
    async (v: string | null) => {
      const err = await updateRow('enrollments', enrId, { [field]: convert ? convert(v) : v });
      if (!err) reload();
      return err;
    };

  return (
    <div className="card-page">
      <button className="btn btn-sm back-btn" onClick={back}>← К списку</button>

      <h1>{s.full_name}</h1>
      <p className="muted subtitle">
        {age !== null ? pluralYears(age) : s.birth_date_raw ? `дата рождения: ${s.birth_date_raw}` : 'возраст не указан'}
        {!isAdmin && ' · просмотр'}
      </p>

      <section className="panel">
        <h2>Ученик</h2>
        <EditableField
          label="ФИО"
          value={s.full_name}
          required
          canEdit={isAdmin}
          onSave={saveStudent('full_name')}
        />
        <EditableField
          label="Дата рождения"
          kind="date"
          value={s.birth_date}
          canEdit={isAdmin}
          display={(v) => (v ? formatDate(v) : s.birth_date_raw ? `${s.birth_date_raw} (не распознана)` : null)}
          hint={s.birth_date ? undefined : s.birth_date_raw ? 'Дата в исходной таблице записана текстом. Введите её заново, и она сохранится как дата.' : undefined}
          onSave={saveStudent('birth_date', (v) => (v ? { birth_date_raw: null } : {}))}
        />
        <EditableField
          label="Свой телефон"
          kind="tel"
          value={s.phone}
          canEdit={isAdmin}
          display={(v) => (v ? <a href={`tel:${v}`}>{formatPhone(v)}</a> : null)}
          hint="Заполняется у взрослых учеников. У детей контакт указан у родителя."
          onSave={savePhone('students', s.id, 'phone')}
        />
      </section>

      <section className="panel">
        <h2>Родитель</h2>
        {g ? (
          <>
            <EditableField
              label="ФИО"
              value={g.full_name}
              canEdit={isAdmin}
              hint={isAdmin && siblings > 1 ? `Этот родитель указан у ${siblings} детей, изменение коснётся всех.` : undefined}
              onSave={saveGuardian('full_name')}
            />
            <EditableField
              label="Телефон"
              kind="tel"
              value={g.phone}
              canEdit={isAdmin}
              display={(v) => (v ? <a href={`tel:${v}`}>{formatPhone(v)}</a> : null)}
              hint={g.phone_raw && g.phone_raw !== g.phone ? `Исходная запись: ${g.phone_raw}` : undefined}
              onSave={savePhone('guardians', g.id, 'phone')}
            />
            <EditableField
              label="E-mail"
              value={g.email}
              canEdit={isAdmin}
              onSave={saveGuardian('email')}
            />
          </>
        ) : isAdmin ? (
          <AddGuardian studentId={s.id} onDone={reload} />
        ) : (
          <p className="muted">Родитель не указан.</p>
        )}
      </section>

      <section>
        <h2 className="section-title">Группы и зачисления</h2>
        {enrollments.length === 0 && <p className="muted">Зачислений нет.</p>}
        {enrollments.map((e) => {
          const grp = groups.get(e.group_id);
          return (
            <div className="panel" key={e.id}>
              <h3>
                {grp ? grp.name : 'Группа'}
                {grp?.teacher && <span className="muted"> · {grp.teacher.full_name}</span>}
              </h3>
              <p className="muted subtitle">Сезон {e.season}</p>
              <EditableField
                label="Статус"
                kind="select"
                options={STATUS_OPTIONS}
                value={e.status}
                required
                canEdit={isAdmin}
                hint={
                  e.status === 'left' && !e.end_date
                    ? 'Укажите дату окончания: пока её нет, посещаемость для этого ученика отмечать нельзя.'
                    : e.status === 'reserve'
                      ? 'Пока статус «Резерв», ученик в списках посещаемости не показывается.'
                      : undefined
                }
                onSave={saveEnrollment(e.id, 'status')}
              />
              <EditableField
                label="Тип группы"
                kind="select"
                options={PRIMARY_OPTIONS}
                value={e.is_primary ? 'true' : 'false'}
                required
                canEdit={isAdmin}
                onSave={saveEnrollment(e.id, 'is_primary', (v) => v === 'true')}
              />
              <EditableField
                label="Начало занятий"
                kind="date"
                value={e.start_date}
                canEdit={isAdmin}
                display={(v) => (v ? formatDate(v) : null)}
                onSave={saveEnrollment(e.id, 'start_date')}
              />
              <EditableField
                label="Окончание занятий"
                kind="date"
                value={e.end_date}
                canEdit={isAdmin}
                display={(v) => (v ? formatDate(v) : null)}
                onSave={saveEnrollment(e.id, 'end_date')}
              />
              <EditableField
                label="Пробное: дата"
                kind="date"
                value={e.trial_date}
                canEdit={isAdmin}
                display={(v) => (v ? formatDate(v) : null)}
                onSave={saveEnrollment(e.id, 'trial_date')}
              />
              <EditableField
                label="Пробное: примечание"
                value={e.trial_note}
                canEdit={isAdmin}
                onSave={saveEnrollment(e.id, 'trial_note')}
              />
              {isAdmin && (
                <>
                  <EditableField
                    label="Договор №"
                    value={e.contract_number}
                    canEdit
                    onSave={saveEnrollment(e.id, 'contract_number')}
                  />
                  <EditableField
                    label="Дата договора"
                    kind="date"
                    value={e.contract_date}
                    canEdit
                    display={(v) => (v ? formatDate(v) : null)}
                    onSave={saveEnrollment(e.id, 'contract_date')}
                  />
                  <EditableField
                    label="Заметки"
                    kind="textarea"
                    value={e.notes}
                    canEdit
                    onSave={saveEnrollment(e.id, 'notes')}
                  />
                </>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
