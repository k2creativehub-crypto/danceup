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
