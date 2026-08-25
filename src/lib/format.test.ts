import { describe, expect, it } from 'vitest';
import { formatAmount, formatPercent } from './format';
import { roundAmount, sumAmounts } from './amount';

describe('formatAmount', () => {
  it('整数はそのまま', () => {
    expect(formatAmount(12, 'ページ')).toBe('12ページ');
  });

  it('小数の余分な 0 を落とす', () => {
    expect(formatAmount(2.5, '時間')).toBe('2.5時間');
    expect(formatAmount(2.0, '時間')).toBe('2時間');
  });

  it('極小の値を 0 に潰さない', () => {
    expect(formatAmount(0.004, '語')).toBe('0.004語');
  });

  it('単位が無ければ数値だけ', () => {
    expect(formatAmount(3)).toBe('3');
  });

  it('数値でない値でも壊れない', () => {
    expect(formatAmount(Number.NaN, '語')).toBe('-語');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('-');
  });
});

describe('formatPercent', () => {
  it('割合を百分率にする', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('終わっていないのに 100% と出さない', () => {
    expect(formatPercent(0.999)).toBe('99%');
    expect(formatPercent(0.9999999)).toBe('99%');
  });

  it('範囲外の値を丸める', () => {
    expect(formatPercent(1.5)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });
});

describe('sumAmounts', () => {
  it('浮動小数点の誤差を積み上げない', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    expect(sumAmounts(Array.from({ length: 3 }, () => 33.333333))).toBe(99.999999);
  });

  it('空配列は 0', () => {
    expect(sumAmounts([])).toBe(0);
  });

  it('数値でない値を無視する', () => {
    expect(sumAmounts([1, Number.NaN, 2])).toBe(3);
  });
});

describe('roundAmount', () => {
  it('小数6桁に丸める', () => {
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
    expect(roundAmount(33.3333333)).toBe(33.333333);
  });
});
