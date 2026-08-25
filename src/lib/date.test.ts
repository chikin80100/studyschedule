import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  eachDate,
  formatMonth,
  formatShort,
  isValidDateString,
  tryAddDays,
} from './date';

describe('isValidDateString', () => {
  it('正しい日付を受け入れる', () => {
    expect(isValidDateString('2026-09-01')).toBe(true);
    expect(isValidDateString('2028-02-29')).toBe(true); // うるう年
  });

  it('存在しない日付を弾く', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2027-02-29')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });

  it('形式が違うものを弾く', () => {
    expect(isValidDateString('2026/09/01')).toBe(false);
    expect(isValidDateString('2026-9-1')).toBe(false);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString(20260901)).toBe(false);
  });
});

describe('addDays', () => {
  it('月・年をまたいで加算できる', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('うるう日を挟んでも正しい', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('扱える範囲を超えると例外になる', () => {
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
    expect(() => addDays('0000-01-01', -1)).toThrow(RangeError);
  });

  it('tryAddDays は範囲外で null を返す', () => {
    expect(tryAddDays('9999-12-31', 1)).toBeNull();
    expect(tryAddDays('2026-09-01', 1)).toBe('2026-09-02');
  });
});

describe('diffDays / eachDate / dayOfWeek', () => {
  it('日数の差を返す', () => {
    expect(diffDays('2026-09-01', '2026-09-01')).toBe(0);
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29);
    expect(diffDays('2026-09-30', '2026-09-01')).toBe(-29);
  });

  it('両端を含めて列挙する', () => {
    expect(eachDate('2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(eachDate('2026-09-01', '2026-09-01')).toEqual(['2026-09-01']);
  });

  it('曜日を返す (0=日)', () => {
    expect(dayOfWeek('2026-09-06')).toBe(0);
    expect(dayOfWeek('2026-09-07')).toBe(1);
    expect(dayOfWeek('2026-09-12')).toBe(6);
  });

  it('夏時間の切り替わりを挟んでもずれない', () => {
    // 米国 2026-03-08 / 欧州 2026-03-29 / 豪州 2026-04-05
    for (const date of ['2026-03-07', '2026-03-28', '2026-04-04']) {
      expect(diffDays(date, addDays(date, 1))).toBe(1);
    }
    expect(eachDate('2026-03-07', '2026-03-09')).toHaveLength(3);
  });
});

describe('表示用の整形', () => {
  it('短い形式', () => {
    expect(formatShort('2026-09-01')).toBe('9/1(火)');
  });

  it('月見出し', () => {
    expect(formatMonth('2026-09-01')).toBe('2026年9月');
  });
});
