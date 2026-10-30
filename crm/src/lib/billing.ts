import { supabase } from '../supabase';
import { monthBounds } from './dates';

// ВНИМАНИЕ: имена параметров SQL-функций в архиве не видны (в тестах они вызываются позиционно).
// Если в вашей базе они называются иначе, поменяйте только эти константы.
const ARG = {
  balanceOn: 'p_on',
  invFrom: 'p_from',
  invTo: 'p_to',
  invGroup: 'p_group_id',
};

export interface BalanceRow {
  student_id: string;
  charged_kopecks: number;
  paid_kopecks: number;
  debt_kopecks: number; // > 0 долг, < 0 переплата
}

export interface InvoiceLine {
  student_id: string;
  group_id: string; // нужно, чтобы показать строки по группам
  lessons_count: number;
  amount_kopecks: number;
  lessons_without_price: number;
}

export interface Payment {
  id: string;
  student_id: string;
  paid_on: string;
  amount_kopecks: number;
}

// Баланс на конец месяца, нарастающим итогом.
export async function fetchBalances(ym: string): Promise<BalanceRow[]> {
  const { to } = monthBounds(ym);
  const { data, error } = await supabase.rpc('student_balances', { [ARG.balanceOn]: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as BalanceRow[];
}

export async function fetchInvoiceLines(ym: string, groupId: string | null): Promise<InvoiceLine[]> {
  const { from, to } = monthBounds(ym);
  const { data, error } = await supabase.rpc('invoice_lines', {
    [ARG.invFrom]: from,
    [ARG.invTo]: to,
    [ARG.invGroup]: groupId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceLine[];
}

export async function fetchPayments(studentId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, student_id, paid_on, amount_kopecks')
    .eq('student_id', studentId)
    .order('paid_on', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Payment[];
}

// Студенты группы за месяц, у которых есть хотя бы одна отметка (любая: +, −, б, п).
export async function fetchMarkedStudents(groupId: string, ym: string): Promise<Set<string>> {
  const { from, to } = monthBounds(ym);
  const { data, error } = await supabase
    .from('lessons')
    .select('attendance(student_id)')
    .eq('group_id', groupId)
    .gte('lesson_date', from)
    .lte('lesson_date', to);
  if (error) throw new Error(error.message);
  const s = new Set<string>();
  for (const l of (data ?? []) as unknown as { attendance: { student_id: string }[] }[])
    for (const a of l.attendance) s.add(a.student_id);
  return s;
}

// Печать: класс на body включает печатные стили (см. styles.css), после печати снимается.
export function printNow() {
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

export function pluralYearsRu(n: number): string {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return `${n} лет`;
  if (b === 1) return `${n} год`;
  if (b >= 2 && b <= 4) return `${n} года`;
  return `${n} лет`;
}
