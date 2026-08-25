import { describe, expect, it } from 'vitest';
import {
  MAX_SPAN_DAYS,
  buildSchedule,
  generateTasks,
  resolveStep,
  validateScheduleInput,
} from './taskGenerator';
import type { ScheduleInput } from './taskGenerator';
import { sumBy } from './amount';
import { createDefaultWeekdaySettings } from '../types';
import type { DayOfWeek, Plan, Task } from '../types';

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    totalAmount: 300,
    weekdaySettings: createDefaultWeekdaySettings(),
    bufferRatio: 0,
    roundingStep: 'auto',
    ...overrides,
  };
}

/** アプリ本体と同じ集計方法(最小単位の整数に直して合算)で合計を出す。 */
function sumPlanned(entries: { plannedAmount: number }[]): number {
  return sumBy(entries, (entry) => entry.plannedAmount);
}

function withWeekday(changes: { dayOfWeek: DayOfWeek; isRestDay?: boolean; weight?: number }[]) {
  const settings = createDefaultWeekdaySettings();
  for (const change of changes) {
    settings[change.dayOfWeek] = {
      dayOfWeek: change.dayOfWeek,
      isRestDay: change.isRestDay ?? false,
      weight: change.weight ?? 1,
    };
  }
  return settings;
}

function utcDay(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

describe('validateScheduleInput', () => {
  it('正しい入力では null を返す', () => {
    expect(validateScheduleInput(input())).toBeNull();
  });

  it('終了日が開始日より前ならエラー', () => {
    expect(validateScheduleInput(input({ endDate: '2026-08-01' }))).toMatch(/終了日/);
  });

  it('総量が 0 以下ならエラー', () => {
    expect(validateScheduleInput(input({ totalAmount: 0 }))).toMatch(/総量/);
  });

  it('総量が大きすぎるとエラー', () => {
    expect(validateScheduleInput(input({ totalAmount: 1e12 }))).toMatch(/総量/);
  });

  it('全曜日が休養日ならエラー', () => {
    const settings = createDefaultWeekdaySettings().map((s) => ({ ...s, isRestDay: true }));
    expect(validateScheduleInput(input({ weekdaySettings: settings }))).toMatch(/学習する日/);
  });

  it('全曜日の量が 0 ならエラー', () => {
    const settings = createDefaultWeekdaySettings().map((s) => ({ ...s, weight: 0 }));
    expect(validateScheduleInput(input({ weekdaySettings: settings }))).toMatch(/学習する日/);
  });

  it('予備日の割合が範囲外ならエラー', () => {
    expect(validateScheduleInput(input({ bufferRatio: 0.8 }))).toMatch(/予備日/);
    expect(validateScheduleInput(input({ bufferRatio: Number.NaN }))).toMatch(/予備日/);
  });

  it('切り上げ単位が不正ならエラー', () => {
    expect(validateScheduleInput(input({ roundingStep: Number.POSITIVE_INFINITY }))).toMatch(/単位/);
    expect(validateScheduleInput(input({ roundingStep: 0 }))).toMatch(/単位/);
    expect(validateScheduleInput(input({ roundingStep: -1 }))).toMatch(/単位/);
    expect(validateScheduleInput(input({ roundingStep: Number.NaN }))).toMatch(/単位/);
  });

  it('期間が長すぎるとエラー', () => {
    expect(validateScheduleInput(input({ endDate: '2999-12-31' }))).toMatch(/期間が長すぎます/);
  });

  it('上限ぎりぎりの期間は通る', () => {
    const start = '2026-01-01';
    const end = new Date(Date.UTC(2026, 0, 1) + (MAX_SPAN_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(validateScheduleInput(input({ startDate: start, endDate: end }))).toBeNull();
  });

  it('曜日設定に重複や欠落があるとエラー', () => {
    const settings = createDefaultWeekdaySettings().map((s) => ({ ...s, dayOfWeek: 0 as DayOfWeek }));
    expect(validateScheduleInput(input({ weekdaySettings: settings }))).toMatch(/曜日設定/);
  });

  it('扱える日付の範囲外はエラー', () => {
    expect(validateScheduleInput(input({ startDate: '1800-01-01', endDate: '1800-01-10' }))).toMatch(
      /範囲/,
    );
  });
});

describe('buildSchedule: 合計量の一致(不変条件)', () => {
  it('計画量の合計が総量と厳密に一致する', () => {
    const schedule = buildSchedule(input());
    expect(sumPlanned(schedule.entries)).toBe(300);
    expect(schedule.plannedTotal).toBe(300);
  });

  it('切り上げが起きるケースでも合計が一致する', () => {
    expect(sumPlanned(buildSchedule(input({ totalAmount: 100 })).entries)).toBe(100);
  });

  it('浮動小数点誤差が出やすい組み合わせでも厳密に一致する', () => {
    for (const totalAmount of [1, 2, 3, 7, 33.3, 0.7, 12.5, 99.99]) {
      for (const bufferRatio of [0, 0.1, 0.2]) {
        const schedule = buildSchedule(input({ totalAmount, bufferRatio, roundingStep: 0.1 }));
        expect(sumPlanned(schedule.entries)).toBe(totalAmount);
        expect(schedule.plannedTotal).toBe(totalAmount);
      }
    }
  });

  it('総当たりで合計が一致する', () => {
    for (let totalAmount = 1; totalAmount <= 300; totalAmount += 1) {
      for (const bufferRatio of [0, 0.15, 0.25]) {
        const schedule = buildSchedule(input({ totalAmount, bufferRatio }));
        expect(sumPlanned(schedule.entries)).toBe(totalAmount);
        expect(schedule.plannedTotal).toBe(totalAmount);
      }
    }
  });

  it('小数4桁以上の総量でも過不足なく配分する', () => {
    expect(sumPlanned(buildSchedule(input({ totalAmount: 33.3333 })).entries)).toBe(33.3333);
    expect(sumPlanned(buildSchedule(input({ totalAmount: 10.0009, endDate: '2026-09-01' })).entries)).toBe(
      10.0009,
    );
  });

  it('切り上げ単位より総量が小さくても1日目に全量が入る', () => {
    const schedule = buildSchedule(input({ totalAmount: 0.1, roundingStep: 10 }));
    expect(sumPlanned(schedule.entries)).toBe(0.1);
    expect(schedule.studyDayCount).toBe(1);
    expect(schedule.finishDate).toBe('2026-09-01');
  });

  it('極端に小さい総量でも計画量が消えない', () => {
    const schedule = buildSchedule(input({ totalAmount: 0.0004 }));
    expect(sumPlanned(schedule.entries)).toBeCloseTo(0.0004, 10);
    expect(schedule.studyDayCount).toBeGreaterThan(0);
  });

  it('予備日と重みを併用しても合計が一致する', () => {
    const schedule = buildSchedule(
      input({
        totalAmount: 437,
        bufferRatio: 0.15,
        weekdaySettings: withWeekday([
          { dayOfWeek: 0, isRestDay: true },
          { dayOfWeek: 6, weight: 0.5 },
        ]),
      }),
    );
    expect(sumPlanned(schedule.entries)).toBe(437);
  });
});

describe('buildSchedule: 学習しない日', () => {
  it('休養日にはタスクを作らない', () => {
    const schedule = buildSchedule(
      input({ weekdaySettings: withWeekday([{ dayOfWeek: 0, isRestDay: true }]) }),
    );
    expect(schedule.entries.filter((e) => utcDay(e.date) === 0)).toHaveLength(0);
    // 2026-09-01 〜 09-30 の日曜は 6, 13, 20, 27 の 4 日
    expect(schedule.offDayCount).toBe(4);
    expect(schedule.entries).toHaveLength(26);
  });

  it('量の比率が 0 の曜日も休養日と同じくタスクを作らない', () => {
    const schedule = buildSchedule(
      input({ weekdaySettings: withWeekday([{ dayOfWeek: 6, weight: 0 }]) }),
    );
    expect(schedule.entries.filter((e) => utcDay(e.date) === 6)).toHaveLength(0);
    expect(schedule.offDayCount).toBe(4); // 9月の土曜は 5, 12, 19, 26 の 4 日
    expect(sumPlanned(schedule.entries)).toBe(300);
  });

  it('学習する曜日が予備日に飲み込まれても、その曜日以外に配分しない', () => {
    // 日曜だけ学習する設定。予備日を多く取っても月〜土に量が入ってはいけない。
    const settings = createDefaultWeekdaySettings().map((s) => ({
      ...s,
      weight: s.dayOfWeek === 0 ? 1 : 0,
    }));
    const schedule = buildSchedule(
      input({
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        bufferRatio: 0.5,
        weekdaySettings: settings,
      }),
    );
    expect(schedule.entries.every((e) => utcDay(e.date) === 0)).toBe(true);
    expect(sumPlanned(schedule.entries)).toBe(300);
  });
});

describe('buildSchedule: 余白 (予備日)', () => {
  it('bufferRatio 分の予備日が末尾に確保される', () => {
    const schedule = buildSchedule(input({ bufferRatio: 0.2, roundingStep: 0.1 }));
    const lastSix = schedule.entries.slice(-6);
    expect(lastSix.every((e) => e.kind === 'buffer')).toBe(true);
    expect(schedule.studyDayCount).toBe(24);
  });

  it('予備日の日数が浮動小数点誤差で1日ずれない', () => {
    const schedule = buildSchedule(
      input({
        startDate: '2026-01-01',
        endDate: '2026-06-29',
        bufferRatio: 0.35,
        totalAmount: 117,
        roundingStep: 1,
      }),
    );
    // 180 活動日 * 0.35 = 63 日。62 日にずれていないことを確かめる。
    expect(schedule.entries).toHaveLength(180);
    expect(schedule.entries.slice(-63).every((e) => e.kind === 'buffer')).toBe(true);
    expect(schedule.entries.at(-64)?.kind).toBe('study');
  });

  it('bufferRatio が 0 かつ端数が出なければ予備日は生まれない', () => {
    const schedule = buildSchedule(input({ totalAmount: 300, roundingStep: 0.1 }));
    expect(schedule.bufferDayCount).toBe(0);
    expect(schedule.finishDate).toBe('2026-09-30');
  });

  it('切り上げにより予定より前倒しで終わる', () => {
    const schedule = buildSchedule(input({ totalAmount: 100, roundingStep: 1 }));
    expect(schedule.maxDailyAmount).toBe(4);
    expect(schedule.finishDate).toBe('2026-09-25');
    expect(schedule.bufferDayCount).toBe(5);
  });

  it('予備日を大きく取っても作業日は最低1日残る', () => {
    const schedule = buildSchedule(
      input({ startDate: '2026-09-01', endDate: '2026-09-02', bufferRatio: 0.5 }),
    );
    expect(schedule.studyDayCount).toBeGreaterThanOrEqual(1);
    expect(sumPlanned(schedule.entries)).toBe(300);
  });

  it('予備日の計画量は必ず 0', () => {
    const schedule = buildSchedule(input({ bufferRatio: 0.25, totalAmount: 137 }));
    expect(schedule.entries.filter((e) => e.kind === 'buffer').every((e) => e.plannedAmount === 0)).toBe(
      true,
    );
  });
});

describe('buildSchedule: 重み', () => {
  it('曜日ごとの重みが配分に反映される', () => {
    const schedule = buildSchedule(
      input({
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        totalAmount: 120,
        roundingStep: 0.1,
        weekdaySettings: withWeekday([
          { dayOfWeek: 1, weight: 2 },
          { dayOfWeek: 2, weight: 2 },
          { dayOfWeek: 3, weight: 2 },
          { dayOfWeek: 4, weight: 2 },
          { dayOfWeek: 5, weight: 2 },
        ]),
      }),
    );
    const byDate = new Map(schedule.entries.map((e) => [e.date, e.plannedAmount]));
    // 重み合計 = 2*5 + 1*2 = 12 → 平日 20 / 土日 10
    expect(byDate.get('2026-09-07')).toBe(20);
    expect(byDate.get('2026-09-12')).toBe(10);
    expect(byDate.get('2026-09-13')).toBe(10);
    expect(sumPlanned(schedule.entries)).toBe(120);
  });
});

describe('buildSchedule: 境界', () => {
  it('1日だけの期間', () => {
    const schedule = buildSchedule(input({ startDate: '2026-09-01', endDate: '2026-09-01' }));
    expect(schedule.entries).toHaveLength(1);
    expect(schedule.entries[0].plannedAmount).toBe(300);
  });

  it('月をまたぐ期間を正しく列挙する', () => {
    const schedule = buildSchedule(input({ startDate: '2026-12-28', endDate: '2027-01-03' }));
    expect(schedule.entries.map((e) => e.date)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('うるう日を含む期間', () => {
    const schedule = buildSchedule(input({ startDate: '2028-02-27', endDate: '2028-03-01' }));
    expect(schedule.entries.map((e) => e.date)).toContain('2028-02-29');
  });

  it('全曜日休養日なら例外を投げる', () => {
    const settings = createDefaultWeekdaySettings().map((s) => ({ ...s, isRestDay: true }));
    expect(() => buildSchedule(input({ weekdaySettings: settings }))).toThrow(/学習する日/);
  });
});

describe('resolveStep', () => {
  it('明示指定された単位を優先する', () => {
    expect(resolveStep(5, 3)).toBe(5);
  });

  it('不正な単位は自動選択に倒す', () => {
    expect(resolveStep(Number.POSITIVE_INFINITY, 8)).toBe(1);
    expect(resolveStep(0, 8)).toBe(1);
    expect(resolveStep(Number.NaN, 8)).toBe(1);
  });

  it('平均量に応じてキリのいい単位を選ぶ', () => {
    expect(resolveStep('auto', 250)).toBe(10);
    expect(resolveStep('auto', 30)).toBe(5);
    expect(resolveStep('auto', 8)).toBe(1);
    expect(resolveStep('auto', 1)).toBe(0.5);
    expect(resolveStep('auto', 0.2)).toBe(0.1);
  });
});

describe('generateTasks', () => {
  const plan: Plan = {
    id: 'plan-1',
    title: '数学の問題集',
    unit: 'ページ',
    startDate: '2026-09-01',
    endDate: '2026-09-10',
    totalAmount: 100,
    weekdaySettings: createDefaultWeekdaySettings(),
    bufferRatio: 0,
    roundingStep: 'auto',
    createdAt: '2026-08-25T00:00:00.000Z',
  };

  it('プランに紐づくタスクを日付順で生成する', () => {
    const tasks = generateTasks(plan);
    expect(tasks).toHaveLength(10);
    expect(tasks.every((task) => task.planId === 'plan-1')).toBe(true);
    expect(tasks[0].date).toBe('2026-09-01');
    expect(tasks.at(-1)?.date).toBe('2026-09-10');
  });

  it('同じ日付の実績を引き継ぐ', () => {
    const previous = generateTasks(plan).map((task) =>
      task.date === '2026-09-02' ? { ...task, doneAmount: 7, isCompleted: true } : task,
    );
    const regenerated = generateTasks({ ...plan, totalAmount: 200 }, previous);
    const kept = regenerated.find((task) => task.date === '2026-09-02');
    expect(kept?.doneAmount).toBe(7);
    expect(kept?.isCompleted).toBe(true);
    expect(kept?.plannedAmount).toBe(20);
  });

  it('他のプランの実績を取り込まない', () => {
    const foreign: Task[] = [
      {
        id: 'plan-2-2026-09-02',
        planId: 'plan-2',
        date: '2026-09-02',
        kind: 'study',
        plannedAmount: 99,
        doneAmount: 99,
        isCompleted: true,
      },
    ];
    const tasks = generateTasks(plan, foreign);
    const target = tasks.find((task) => task.date === '2026-09-02');
    expect(target?.doneAmount).toBe(0);
    expect(target?.isCompleted).toBe(false);
  });

  it('予備日になった日は完了フラグを引き継がない', () => {
    const previous = generateTasks(plan).map((task) =>
      task.date === '2026-09-09' ? { ...task, doneAmount: 10, isCompleted: true } : task,
    );
    const regenerated = generateTasks({ ...plan, bufferRatio: 0.5 }, previous);
    const target = regenerated.find((task) => task.date === '2026-09-09');
    expect(target?.kind).toBe('buffer');
    expect(target?.plannedAmount).toBe(0);
    expect(target?.isCompleted).toBe(false);
    expect(target?.doneAmount).toBe(10); // 実際にやった記録は残す
  });

  it('期間が縮むと範囲外のタスクは消える', () => {
    const previous = generateTasks(plan);
    const regenerated = generateTasks({ ...plan, endDate: '2026-09-05' }, previous);
    expect(regenerated).toHaveLength(5);
  });
});
