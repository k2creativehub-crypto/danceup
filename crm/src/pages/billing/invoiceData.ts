import { ageYears } from '../../lib/format';
import { pluralYearsRu } from '../../lib/billing';
import type { InvoiceLine } from '../../lib/billing';
import type { InvoiceView } from './InvoiceSheet';
import type { useDirectory } from '../../lib/store';

type Dir = ReturnType<typeof useDirectory>;

// Счёт одного ученика: строки по группам, несколько групп суммируются в одном счёте.
export function buildInvoice(dir: Dir, studentId: string, ym: string, lines: InvoiceLine[]): InvoiceView {
  const st = dir.studentById.get(studentId);
  const age = st ? ageYears(st.birth_date) : null;
  const rows = lines
    .filter((l) => l.student_id === studentId)
    .map((l) => {
      const g = dir.groupById.get(l.group_id);
      return {
        groupName: g?.name ?? 'Группа',
        teacher: g?.teacher?.full_name ?? '—',
        lessons: l.lessons_count,
        amount: l.amount_kopecks,
        noPrice: l.lessons_without_price,
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru'));
  return { studentName: st?.full_name ?? 'Ученик', ageLabel: age == null ? null : pluralYearsRu(age), ym, rows };
}
