import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import EditableField from '../components/EditableField';
import type { Option } from '../components/EditableField';
import { updateRow } from '../lib/db';
import { PHONE_HINT, normalizePhone } from '../lib/phone';
import { ageYears, formatDate, formatPhone, pluralYears } from '../lib/format';
import { useDirectory } from '../lib/store';

// Данные, которых нет в общем справочнике: e-mail, договоры, заметки. Они подгружаются фоном.
interface GuardianExtra {
  id: string;
  phone_raw: string | null;
  email: string | null;
}
interface EnrExtra {
  id: string;
  season: string;
  trial_date: string | null;
  trial_note: string | null;
  contract_number: string | null;
  contract_date: string | null;
  notes: string | null;
}
interface Extras {
  forId: string;
  guardian: GuardianExtra | null;
  enrollments: Map<string, EnrExtra>;
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

const STATUS_LABEL: Record<string, string> = {
  active: 'Занимается',
  reserve: 'Резерв',
  left: 'Выбыл',
};

function SkeletonRow({ label }: { label?: string }) {
  return (
    <div className="field-row">
      <div className="field-label">{label ?? ''}</div>
      <div className="field-body">
        <span className="skeleton skeleton-line" style={{ width: '55%' }} />
      </div>
    </div>
  );
}

export default function StudentCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const dir = useDirectory();
  const isAdmin = profile?.role === 'admin';

  const [extras, setExtras] = useState<Extras | null>(null);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [st, en] = await Promise.all([
        supabase.from('students').select('id, guardian:guardians(id, phone_raw, email)').eq('id', id).maybeSingle(),
        supabase
          .from('enrollments_v')
          .select('id, season, trial_date, trial_note, contract_number, contract_date, notes')
          .eq('student_id', id),
      ]);
      if (cancelled) return;
      const firstError = st.error ?? en.error;
      if (firstError) {
        setExtrasError(firstError.message);
        return;
      }
      setExtrasError(null);
      const row = (st.data ?? null) as unknown as { guardian: GuardianExtra | null } | null;
      const map = new Map<string, EnrExtra>();
      for (const e of (en.data ?? []) as unknown as EnrExtra[]) map.set(e.id, e);
      setExtras({ forId: id, guardian: row?.guardian ?? null, enrollments: map });
    })();
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  const base = id ? dir.studentById.get(id) : undefined;
  const ready = !!id && extras?.forId === id;

  const siblings = useMemo(() => {
    const gid = base?.guardian_id;
    return gid ? dir.students.filter((x) => x.guardian_id === gid).length : 0;
  }, [dir.students, base?.guardian_id]);

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/crm');
  };
  const close = () => navigate('/crm');

  const navButtons = (
    <>
      <button className="btn btn-sm back-btn" onClick={back}>← К списку</button>
      <button className="btn btn-sm close-btn" onClick={close}>✕ Закрыть</button>
    </>
  );

  if (dir.error) return <p className="error">Не удалось загрузить карточку: {dir.error}</p>;

  // Справочник ещё грузится: сразу показываем рамку карточки.
  if (dir.loading) {
    return (
      <div className="card-page">
        {navButtons}
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="panel">
          <span className="skeleton skeleton-line" style={{ width: '40%' }} />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </div>
      </div>
    );
  }

  if (!base) {
    return (
      <div className="card-page">
        {navButtons}
        <p className="muted" style={{ marginTop: 16 }}>Ученик не найден или нет доступа.</p>
      </div>
    );
  }

  const s = base;
  const g = s.guardian;
  const gid = s.guardian_id;
  const age = ageYears(s.birth_date);
  const enrollments = dir.enrollmentsByStudent.get(s.id) ?? [];

  const saveStudent = (field: string, extra?: (v: string | null) => Record<string, unknown>) =>
    async (v: string | null) => {
      const fields = { [field]: v, ...(extra ? extra(v) : {}) };
      const err = await updateRow('students', s.id, fields);
      if (!err) dir.patch('students', s.id, fields);
      return err;
    };

  const saveStudentPhone = async (v: string | null) => {
    let value: string | null = null;
    if (v !== null) {
      value = normalizePhone(v);
      if (!value) return PHONE_HINT;
    }
    const err = await updateRow('students', s.id, { phone: value });
    if (!err) dir.patch('students', s.id, { phone: value });
    return err;
  };

  const saveGuardianCore = (field: 'full_name' | 'phone') => async (v: string | null) => {
    if (!gid) return 'Родитель не найден';
    let value: string | null = v;
    if (field === 'phone' && v !== null) {
      value = normalizePhone(v);
      if (!value) return PHONE_HINT;
    }
    const err = await updateRow('guardians', gid, { [field]: value });
    if (!err) dir.patchGuardian(gid, { [field]: value });
    return err;
  };

  const patchExtraGuardian = (fields: Partial<GuardianExtra>) =>
    setExtras((prev) => (prev && prev.guardian ? { ...prev, guardian: { ...prev.guardian, ...fields } } : prev));

  const saveGuardianEmail = async (v: string | null) => {
    if (!gid) return 'Родитель не найден';
    const err = await updateRow('guardians', gid, { email: v });
    if (!err) patchExtraGuardian({ email: v });
    return err;
  };

  const patchExtraEnr = (enrId: string, fields: Partial<EnrExtra>) =>
    setExtras((prev) => {
      const cur = prev?.enrollments.get(enrId);
      if (!prev || !cur) return prev;
      const map = new Map(prev.enrollments);
      map.set(enrId, { ...cur, ...fields });
      return { ...prev, enrollments: map };
    });

  const saveEnrCore = (enrId: string, field: string, convert?: (v: string | null) => unknown) =>
    async (v: string | null) => {
      const value = convert ? convert(v) : v;
      const err = await updateRow('enrollments', enrId, { [field]: value });
      if (!err) dir.patch('enrollments', enrId, { [field]: value });
      return err;
    };

  const saveEnrExtra = (enrId: string, field: keyof EnrExtra) => async (v: string | null) => {
    const err = await updateRow('enrollments', enrId, { [field]: v });
    if (!err) patchExtraEnr(enrId, { [field]: v } as Partial<EnrExtra>);
    return err;
  };

  const phoneRaw = ready ? extras?.guardian?.phone_raw ?? null : null;

  return (
    <div className="card-page">
      {navButtons}

      <h1>{s.full_name}</h1>
      <p className="muted subtitle">
        {age !== null ? pluralYears(age) : s.birth_date_raw ? `дата рождения: ${s.birth_date_raw}` : 'возраст не указан'}
        {!isAdmin && ' · просмотр'}
      </p>
      {extrasError && <p className="error">Не удалось догрузить подробности: {extrasError}</p>}

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
          onSave={saveStudentPhone}
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
              onSave={saveGuardianCore('full_name')}
            />
            <EditableField
              label="Телефон"
              kind="tel"
              value={g.phone}
              canEdit={isAdmin}
              display={(v) => (v ? <a href={`tel:${v}`}>{formatPhone(v)}</a> : null)}
              hint={phoneRaw && phoneRaw !== g.phone ? `Исходная запись: ${phoneRaw}` : undefined}
              onSave={saveGuardianCore('phone')}
            />
            {ready ? (
              <EditableField
                label="E-mail"
                value={extras?.guardian?.email ?? null}
                canEdit={isAdmin}
                onSave={saveGuardianEmail}
              />
            ) : (
              <SkeletonRow label="E-mail" />
            )}
          </>
        ) : isAdmin ? (
          <AddGuardian
            studentId={s.id}
            onDone={() => {
              void dir.refresh(['students']);
              setVersion((v) => v + 1);
            }}
          />
        ) : (
          <p className="muted">Родитель не указан.</p>
        )}
      </section>

      <section>
        <h2 className="section-title">Группы и зачисления</h2>
        {enrollments.length === 0 && <p className="muted">Зачислений нет.</p>}
        {enrollments.map((e) => {
          const grp = dir.groupById.get(e.group_id);
          const x = ready ? extras?.enrollments.get(e.id) : undefined;
          return (
            <div className="panel" key={e.id}>
              <h3>
                {grp ? grp.name : 'Группа'}
                {grp?.teacher && <span className="muted"> · {grp.teacher.full_name}</span>}
              </h3>
              <p className="muted subtitle">{x ? `Сезон ${x.season}` : grp ? `Сезон ${grp.season}` : ''}</p>
              <EditableField
                label="Статус"
                kind="select"
                options={STATUS_OPTIONS}
                value={e.status}
                required
                canEdit={isAdmin}
                display={(v) => (v ? STATUS_LABEL[v] ?? v : null)}
                hint={
                  e.status === 'left' && !e.end_date
                    ? 'Укажите дату окончания: пока её нет, посещаемость для этого ученика отмечать нельзя.'
                    : e.status === 'reserve'
                      ? 'Пока статус «Резерв», ученик в списках посещаемости не показывается.'
                      : undefined
                }
                onSave={saveEnrCore(e.id, 'status')}
              />
              <EditableField
                label="Тип группы"
                kind="select"
                options={PRIMARY_OPTIONS}
                value={e.is_primary ? 'true' : 'false'}
                required
                canEdit={isAdmin}
                display={(v) => (v === 'true' ? 'Основная группа' : v === 'false' ? 'Дополнительная группа' : null)}
                onSave={saveEnrCore(e.id, 'is_primary', (v) => v === 'true')}
              />
              <EditableField
                label="Начало занятий"
                kind="date"
                value={e.start_date}
                canEdit={isAdmin}
                display={(v) => (v ? formatDate(v) : null)}
                onSave={saveEnrCore(e.id, 'start_date')}
              />
              <EditableField
                label="Окончание занятий"
                kind="date"
                value={e.end_date}
                canEdit={isAdmin}
                display={(v) => (v ? formatDate(v) : null)}
                onSave={saveEnrCore(e.id, 'end_date')}
              />
              {x ? (
                <>
                  <EditableField
                    label="Пробное: дата"
                    kind="date"
                    value={x.trial_date}
                    canEdit={isAdmin}
                    display={(v) => (v ? formatDate(v) : null)}
                    onSave={saveEnrExtra(e.id, 'trial_date')}
                  />
                  <EditableField
                    label="Пробное: примечание"
                    value={x.trial_note}
                    canEdit={isAdmin}
                    onSave={saveEnrExtra(e.id, 'trial_note')}
                  />
                  {isAdmin && (
                    <>
                      <EditableField
                        label="Договор №"
                        value={x.contract_number}
                        canEdit
                        onSave={saveEnrExtra(e.id, 'contract_number')}
                      />
                      <EditableField
                        label="Дата договора"
                        kind="date"
                        value={x.contract_date}
                        canEdit
                        display={(v) => (v ? formatDate(v) : null)}
                        onSave={saveEnrExtra(e.id, 'contract_date')}
                      />
                      <EditableField
                        label="Заметки"
                        kind="textarea"
                        value={x.notes}
                        canEdit
                        onSave={saveEnrExtra(e.id, 'notes')}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  <SkeletonRow label="Пробное" />
                  {isAdmin && <SkeletonRow label="Договор и заметки" />}
                </>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
