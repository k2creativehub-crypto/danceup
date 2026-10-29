// Приводит телефон к формату +375XXXXXXXXX. Если не получилось, возвращает null.
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 9) {
    d = '375' + d; // 291234567
  } else if (d.length === 11 && d.startsWith('80')) {
    d = '375' + d.slice(2); // 80291234567
  } else if (!(d.length === 12 && d.startsWith('375'))) {
    return null;
  }
  return '+' + d;
}

export const PHONE_HINT = 'Телефон в формате +375291234567 (можно вводить с пробелами и скобками)';
