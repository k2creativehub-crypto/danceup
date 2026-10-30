// Работа с датами в виде строк «2026-10-30» без часовых поясов.

const pad = (n: number) => String(n).padStart(2, '0');

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 1 = понедельник ... 7 = воскресенье (как в расписании)
export function isoWeekday(ymd: string): number {
  const w = toUtc(ymd).getUTCDay();
  return w === 0 ? 7 : w;
}

export function addDays(ymd: string, n: number): string {
  const dt = toUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
}

export function datesInMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`);
}

export function monthBounds(ym: string): { from: string; to: string } {
  const all = datesInMonth(ym);
  return { from: all[0], to: all[all.length - 1] };
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dayNum(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

export function weekdayShort(ymd: string): string {
  return WD_SHORT[isoWeekday(ymd) - 1];
}

// «пн, 26 октября»
export function formatLong(ymd: string): string {
  const m = Number(ymd.slice(5, 7));
  return `${weekdayShort(ymd)}, ${dayNum(ymd)} ${MONTHS_GEN[m - 1]}`;
}
