import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { PHONE_HINT, normalizePhone } from '../lib/phone';
import { useDirectory } from '../lib/store';

// Форма «Добавить ученика»: те же поля, что в карточке ученика (ученик + родитель).
// Группы к ученику добавляются потом на странице группы.
export default function AddStudentForm({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [gName, setGName] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [gEmail, setGEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return setErr('Укажите ФИО ученика');

    let phoneNorm: string | null = null;
    if (phone.trim()) {
      phoneNorm = normalizePhone(phone.trim());
      if (!phoneNorm) return setErr(`Свой телефон: ${PHONE_HINT}`);
    }
    let gPhoneNorm: string | null = null;
    if (gPhone.trim()) {
      gPhoneNorm = normalizePhone(gPhone.trim());
      if (!gPhoneNorm) return setErr(`Телефон родителя: ${PHONE_HINT}`);
    }
    if (birth && birth > new Date().toISOString().slice(0, 10)) return setErr('Дата рождения не может быть в будущем');

    const twin = dir.students.find((s) => s.full_name.trim().toLowerCase() === n.toLowerCase());
    if (twin && !window.confirm(`Ученик «${twin.full_name}» уже есть в списке. Всё равно добавить ещё одного с таким ФИО?`)) {
      return;
    }

    setBusy(true);
    setErr(null);

    let guardianId: string | null = null;
    if (gName.trim() || gPhone.trim() || gEmail.trim()) {
      guardianId = crypto.randomUUID();
      const g = await supabase.from('guardians').insert({
        id: guardianId,
        full_name: gName.trim() || null,
        phone: gPhoneNorm,
        phone_raw: gPhone.trim() || null,
        email: gEmail.trim() || null,
      });
      if (g.error) {
        setBusy(false);
        return setErr(`Не удалось сохранить родителя: ${g.error.message}`);
      }
    }

    const studentId = crypto.randomUUID();
    const st = await supabase.from('students').insert({
      id: studentId,
      full_name: n,
      birth_date: birth || null,
      phone: phoneNorm,
      guardian_id: guardianId,
    });
    if (st.error) {
      if (guardianId) await supabase.from('guardians').delete().eq('id', guardianId);
      setBusy(false);
      return setErr(`Не удалось сохранить ученика: ${st.error.message}`);
    }

    await dir.refresh(['students']);
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванова Анна Сергеевна" autoFocus />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
      </label>
      <label className="field">
        <span>Свой телефон (у взрослых учеников)</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375291234567" />
      </label>

      <h3 className="add-sub">Родитель</h3>
      <label className="field">
        <span>ФИО</span>
        <input value={gName} onChange={(e) => setGName(e.target.value)} />
      </label>
      <label className="field">
        <span>Телефон</span>
        <input type="tel" value={gPhone} onChange={(e) => setGPhone(e.target.value)} placeholder="+375291234567" />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} />
      </label>

      {err && <p className="error">{err}</p>}
      <p className="muted small">В группу ученика можно добавить со страницы группы (там же договор и начало занятий).</p>
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
