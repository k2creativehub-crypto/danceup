import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { PencilIcon } from './Icons';

export interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  kind?: 'text' | 'tel' | 'date' | 'textarea' | 'select';
  options?: Option[];
  canEdit: boolean;
  required?: boolean;
  display?: (v: string | null) => ReactNode;
  hint?: ReactNode;
  // Возвращает текст ошибки или null, если сохранено.
  onSave: (v: string | null) => Promise<string | null>;
}

export default function EditableField({
  label,
  value,
  kind = 'text',
  options = [],
  canEdit,
  required = false,
  display,
  hint,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setDraft(value ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const v = draft.trim();
    if (required && !v) {
      setError('Поле не может быть пустым');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSave(v === '' ? null : v);
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setEditing(false);
    if (e.key === 'Enter' && kind !== 'textarea') {
      e.preventDefault();
      void save();
    }
  };

  const shown =
    display !== undefined
      ? display(value)
      : value
        ? kind === 'select'
          ? options.find((o) => o.value === value)?.label ?? value
          : value
        : null;

  return (
    <div className="field-row">
      <div className="field-label">{label}</div>
      <div className="field-body">
        {!editing ? (
          <>
            <div className="field-value">{shown ?? <span className="muted">не указано</span>}</div>
            {canEdit && (
              <button
                type="button"
                className="icon-btn"
                onClick={start}
                aria-label={`Изменить: ${label}`}
                title="Изменить"
              >
                <PencilIcon />
              </button>
            )}
          </>
        ) : (
          <div className="field-edit">
            {kind === 'textarea' ? (
              <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} autoFocus />
            ) : kind === 'select' ? (
              <select value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} autoFocus>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={kind === 'date' ? 'date' : kind === 'tel' ? 'tel' : 'text'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                autoFocus
              />
            )}
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
      </div>
      {error && <div className="error field-error">{error}</div>}
      {hint && <div className="field-hint muted">{hint}</div>}
    </div>
  );
}
