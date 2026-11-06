import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { PHONE_HINT, normalizePhone } from '../lib/phone';
import { todayMinsk } from '../lib/format';
import { useDirectory } from '../lib/store';

interface GroupChoice {
  key: string;
  groupId: string;
  isPrimary: boolean;
}

// Форма «Добавить ученика»: ученик, родитель и (по желанию) сразу группы.
export default function AddStudentForm({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [gName, setGName] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [gEmail, setGEmail] = useState('');
  const [choices, setChoices] = useState<GroupChoice[]>([]);
  const [startDate, setStartDate] = useState(todayMinsk());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Если ученик уже сохранён, а группы не добавились, повторное нажатие не создаёт его второй раз
  const [createdId, setCreatedId] = useState<string | null>(null);

  const groupOptions = [...dir.groups]
    .filter((g) => !g.is_archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));

  const addChoice = () =>
    setChoices((prev) => [...prev, { key: crypto.randomUUID(), groupId: '', isPrimary: prev.length === 0 }]);
  const patchChoice = (key: string, fields: Partial<GroupChoice>) =>
    setChoices((prev) => prev.map((c) => (c.key === key ? { ...c, ...fields } : c)));
  const removeChoice = (key: string) => setChoices((prev) => prev.filter((c) => c.key !== key));

  const submit = async () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!createdId) {
      if (!n) return setErr('Укажите ФИО ученика');
      if (phone.trim() && !normalizePhone(phone.trim())) return setErr(`Свой телефон: ${PHONE_HINT}`);
      if (gPhone.trim() && !normalizePhone(gPhone.trim())) return setErr(`Телефон родителя: ${PHONE_HINT}`);
      if (birth && birth > todayMinsk()) return setErr('Дата рождения не может быть в будущем');
    }
    if (choices.some((c) => !c.groupId)) return setErr('Выберите группу в каждой строке или удалите лишнюю строку');
    const ids = choices.map((c) => c.groupId);
    if (new Set(ids).size !== ids.length) return setErr('Одна и та же группа выбрана дважды');

    if (!createdId) {
      const twin = dir.students.find((s) => s.full_name.trim().toLowerCase() === n.toLowerCase());
      if (twin && !window.confirm(`Ученик «${twin.full_name}» уже есть в списке. Всё равно добавить ещё одного с таким ФИО?`)) {
        return;
      }
    }

    setBusy(true);
    setErr(null);

    let studentId = createdId;
    if (!studentId) {
      let guardianId: string | null = null;
      if (gName.trim() || gPhone.trim() || gEmail.trim()) {
        guardianId = crypto.randomUUID();
        const g = await supabase.from('guardians').insert({
          id: guardianId,
          full_name: gName.trim() || null,
          phone: gPhone.trim() ? normalizePhone(gPhone.trim()) : null,
          phone_raw: gPhone.trim() || null,
          email: gEmail.trim() || null,
        });
        if (g.error) {
          setBusy(false);
          return setErr(`Не удалось сохранить родителя: ${g.error.message}`);
        }
      }

      studentId = crypto.randomUUID();
      const st = await supabase.from('students').insert({
        id: studentId,
        full_name: n,
        birth_date: birth || null,
        phone: phone.trim() ? normalizePhone(phone.trim()) : null,
        guardian_id: guardianId,
      });
      if (st.error) {
        if (guardianId) await supabase.from('guardians').delete().eq('id', guardianId);
        setBusy(false);
        return setErr(`Не удалось сохранить ученика: ${st.error.message}`);
      }
      setCreatedId(studentId);
    }

    if (choices.length > 0) {
      const { error } = await supabase.from('enrollments').insert(
        choices.map((c) => ({
          id: crypto.randomUUID(),
          student_id: studentId,
          group_id: c.groupId,
          season: dir.groupById.get(c.groupId)?.season ?? null,
          is_primary: c.isPrimary,
          status: 'active',
          start_date: startDate || null,
        })),
      );
      if (error) {
        await dir.refresh(['students']);
        setBusy(false);
        return setErr(`Ученик сохранён, но в группу добавить не удалось: ${error.message}. Исправьте и нажмите кнопку ещё раз: ученик второй раз не создастся.`);
      }
    }

    await dir.refresh(['students', 'enrollments']);
    setBusy(false);
    onClose();
    navigate(`/students/${studentId}`);
  };

  return (
    <div className="panel add-student">
      <h2>Новый ученик</h2>

      <h3 className="add-sub">Ученик</h3>
      <label className="field">
        <span>ФИО *</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванова Анна Сергеевна" autoFocus disabled={!!createdId} />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} disabled={!!createdId} />
      </label>
      <label className="field">
        <span>Свой телефон (у взрослых учеников)</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375291234567" disabled={!!createdId} />
      </label>

      <h3 className="add-sub">Родитель</h3>
      <label className="field">
        <span>ФИО</span>
        <input value={gName} onChange={(e) => setGName(e.target.value)} disabled={!!createdId} />
      </label>
      <label className="field">
        <span>Телефон</span>
        <input type="tel" value={gPhone} onChange={(e) => setGPhone(e.target.value)} placeholder="+375291234567" disabled={!!createdId} />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} disabled={!!createdId} />
      </label>

      <h3 className="add-sub">Группа</h3>
      {choices.length === 0 && <p className="muted small">Группу можно не выбирать: добавите позже со страницы группы.</p>}
      {choices.map((c, i) => (
        <div key={c.key} className="add-group-row">
          <select value={c.groupId} onChange={(e) => patchChoice(c.key, { groupId: e.target.value })} aria-label={`Группа ${i + 1}`}>
            <option value="">— выберите группу —</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.teacher?.full_name ?? ''}
              </option>
            ))}
          </select>
          <select
            value={c.isPrimary ? 'true' : 'false'}
            onChange={(e) => patchChoice(c.key, { isPrimary: e.target.value === 'true' })}
            aria-label="Тип группы"
          >
            <option value="true">Основная группа</option>
            <option value="false">Дополнительная группа</option>
          </select>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => removeChoice(c.key)}>
            Убрать
          </button>
        </div>
      ))}
      <div className="field-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-sm" onClick={addChoice}>
          {choices.length === 0 ? '+ Выбрать группу' : '+ Ещё одна группа'}
        </button>
      </div>
      {choices.length > 0 && (
        <label className="field">
          <span>Начало занятий</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
      )}

      {err && <p className="error">{err}</p>}
      <div className="field-actions">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить ученика'}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Отмена
        </button>
      </div>
    </div>
  );
}
