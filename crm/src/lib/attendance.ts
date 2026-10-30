import type { DirEnrollment } from './store';

export type Mark = 'present' | 'absent' | 'sick' | 'trial';

export const MARKS: { value: Mark; symbol: string; label: string }[] = [
  { value: 'present', symbol: '+', label: 'Был' },
  { value: 'absent', symbol: '−', label: 'Не был' },
  { value: 'sick', symbol: 'б', label: 'Болеет' },
  { value: 'trial', symbol: 'п', label: 'Пробное' },
];

export const SYMBOL: Record<Mark, string> = { present: '+', absent: '−', sick: 'б', trial: 'п' };

// Состоит ли ученик в группе на дату. Правило совпадает с функцией enrolled_on в базе:
// active: с start_date (если есть) и до end_date (если есть); left: только если задана end_date и дата не позже неё;
// reserve: нет.
export function enrolledOn(e: DirEnrollment, date: string): boolean {
  if (e.start_date && e.start_date > date) return false;
  if (e.status === 'active') return !e.end_date || e.end_date >= date;
  if (e.status === 'left') return !!e.end_date && e.end_date >= date;
  return false;
}
