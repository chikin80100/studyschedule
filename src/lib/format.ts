/** 量の表示。小数の余分な 0 を落として単位を付ける。 */
export function formatAmount(amount: number, unit = ''): string {
  const rounded = Math.round(amount * 100) / 100;
  const text = Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
  return unit ? `${text}${unit}` : text;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
