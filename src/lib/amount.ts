/** 小数は 6 桁まで扱う。表示・集計の丸め単位。 */
const SCALE = 1e6;

/** 表示や比較に使う丸め。0.1 を10回足して 0.9999… になるのを防ぐ。 */
export function roundAmount(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

/**
 * 量の合計。素直に足すと浮動小数点誤差が積もるので、
 * いったん最小単位の整数に直してから足し上げる。
 */
export function sumAmounts(values: number[]): number {
  let units = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    units += Math.round(value * SCALE);
  }
  return units / SCALE;
}

export function sumBy<T>(items: T[], select: (item: T) => number): number {
  return sumAmounts(items.map(select));
}
