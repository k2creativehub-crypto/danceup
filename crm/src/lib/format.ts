// Возраст считается из даты рождения, в базе он не хранится.
export function ageYears(birth: string | null): number | null {
  if (!birth) return null;
  const [y, m, d] = birth.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const month = now.getMonth() + 1;
  if (month < m || (month === m && now.getDate() < d)) age -= 1;
  return age;
}

export function pluralYears(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return `${n} лет`;
  if (n10 === 1) return `${n} год`;
  if (n10 >= 2 && n10 <= 4) return `${n} года`;
  return `${n} лет`;
}

// +375291234567 -> +375 (29) 123-45-67
export function formatPhone(p: string | null): string {
  if (!p) return '';
  const m = /^\+375(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+375 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : p;
}

export function digits(s: string): string {
  return s.replace(/\D/g, '');
}

// 2026-03-05 -> 05.03.2026
export function formatDate(d: string | null): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

// Сегодняшняя дата по Минску в виде 2026-10-29 (для значений по умолчанию в формах).
export function todayMinsk(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk' }).format(new Date());
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export interface ScheduleSlot {
  id: string;
  group_id: string;
  weekday: number;
  start_time: string;
  end_time: string | null;
  location: string | null;
}

// 19:00:00 -> 19:00
export function timeHM(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

// Слоты одной группы -> «Пн 19:00», «Ср 19:00»
export function scheduleLabels(slots: ScheduleSlot[]): string[] {
  return [...slots]
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
    .map((s) => {
      const end = s.end_time ? `–${timeHM(s.end_time)}` : '';
      return `${WEEKDAYS[s.weekday - 1] ?? '?'} ${timeHM(s.start_time)}${end}`;
    });
}

export function pluralStudents(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return `${n} учеников`;
  if (n10 === 1) return `${n} ученик`;
  if (n10 >= 2 && n10 <= 4) return `${n} ученика`;
  return `${n} учеников`;
}

export const WEEKDAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// 2500 -> «25,00 BYN»
export function formatMoney(kopecks: number): string {
  const v = (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v} BYN`;
}

// «25», «25,5», «25.50» -> копейки; при неверном вводе null
export function parseMoney(input: string): number | null {
  const t = input.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
