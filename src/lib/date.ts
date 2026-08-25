/**
 * 日付は 'YYYY-MM-DD' 文字列で扱う。Date をそのまま持つとタイムゾーンによって
 * 1日ずれるため、内部計算だけ UTC の Date を経由し、外には文字列を返す。
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && toDateString(date) === value;
}

function toDateString(date: Date): string {
  const iso = date.toISOString();
  // 年が 4 桁を超えると toISOString は '+010000-01-01...' の拡張表記になる。
  // そのまま切り出すと不正な日付文字列になるので、扱える範囲外として弾く。
  if (!/^\d{4}-/.test(iso)) {
    throw new RangeError('扱える日付の範囲を超えています。');
  }
  return iso.slice(0, 10);
}

function parse(dateString: string): Date {
  return new Date(`${dateString}T00:00:00Z`);
}

/** ローカルタイムでの「今日」を 'YYYY-MM-DD' で返す。 */
export function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateString: string, days: number): string {
  const date = parse(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/** addDays の例外を投げない版。範囲外なら null。 */
export function tryAddDays(dateString: string, days: number): string | null {
  try {
    return addDays(dateString, days);
  } catch {
    return null;
  }
}

/** 0=日曜 ... 6=土曜 */
export function dayOfWeek(dateString: string): number {
  return parse(dateString).getUTCDay();
}

/** from から to までの日数 (同日なら 0)。 */
export function diffDays(from: string, to: string): number {
  const ms = parse(to).getTime() - parse(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** start から end までの日付を昇順で列挙する (両端を含む)。 */
export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const length = diffDays(start, end);
  for (let i = 0; i <= length; i += 1) {
    dates.push(addDays(start, i));
  }
  return dates;
}

/** '2026-08-25' → '8/25(火)' */
export function formatShort(dateString: string): string {
  const date = parse(dateString);
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${labels[date.getUTCDay()]})`;
}

/** '2026-08-25' → '2026年8月25日(火)' */
export function formatLong(dateString: string): string {
  const date = parse(dateString);
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日(${labels[date.getUTCDay()]})`;
}

/** '2026-08-25' → '2026年8月' (詳細画面の月見出し用) */
export function formatMonth(dateString: string): string {
  const date = parse(dateString);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
}
