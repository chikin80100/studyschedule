/** 量の表示。小数の余分な 0 を落として単位を付ける。 */
export function formatAmount(amount: number, unit = ''): string {
  if (!Number.isFinite(amount)) return unit ? `-${unit}` : '-';
  // 0.004 のような極小値を「0」と出すと消えたように見えるので、小数3桁まで残す。
  const rounded = Math.round(amount * 1000) / 1000;
  return unit ? `${rounded}${unit}` : `${rounded}`;
}

/** 進捗率の表示。終わっていないのに 100% と出さないよう、1 未満は切り捨てる。 */
export function formatPercent(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  if (clamped >= 1) return '100%';
  return `${Math.min(99, Math.floor(clamped * 100))}%`;
}
