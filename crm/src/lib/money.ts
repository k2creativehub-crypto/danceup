// Деньги хранятся в копейках (как в базе: *_kopecks). На экране и в счёте: BYN.
const fmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatByn(kopecks: number): string {
  return `${fmt.format(kopecks / 100)} BYN`;
}

// «12,5» / «12.50» / «1 200» -> копейки; null, если не число или <= 0.
export function parseBynToKopecks(input: string): number | null {
  const s = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const k = Math.round(parseFloat(s) * 100);
  return k > 0 ? k : null;
}
