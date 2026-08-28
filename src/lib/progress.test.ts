import { describe, expect, it } from 'vitest';
import {
  collectDayRecords,
  computeDayCompletion,
  computePace,
  computeStreak,
  expectedAmountBefore,
  findUncheckedTasks,
} from './progress';
import { rescheduleFrom, shouldSuggestReschedule } from './reschedule';
import { generateTasks } from './taskGenerator';
import { sumBy } from './amount';
import { createDefaultWeekdaySettings } from '../types';
import type { Plan, Task } from '../types';

const plan: Plan = {
  id: 'plan-1',
  title: '英単語',
  unit: '語',
  startDate: '2026-09-01',
  endDate: '2026-09-10',
  totalAmount: 100,
  weekdaySettings: createDefaultWeekdaySettings(),
  bufferRatio: 0,
  roundingStep: 1,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

/** 指定した日付までを完了済みにしたタスク一覧を作る。 */
function tasksCompletedThrough(through: string, base = generateTasks(plan)): Task[] {
  return base.map((task) =>
    task.date <= through && task.kind === 'study'
      ? { ...task, doneAmount: task.plannedAmount, isCompleted: true }
      : task,
  );
}

describe('computeStreak', () => {
  it('連続して達成した日数を数える', () => {
    const streak = computeStreak([plan], tasksCompletedThrough('2026-09-05'), '2026-09-05');
    expect(streak.current).toBe(5);
    expect(streak.longest).toBe(5);
    expect(streak.achievedDays).toBe(5);
  });

  it('未達成の日で連続が途切れる', () => {
    const tasks = tasksCompletedThrough('2026-09-05').map((task) =>
      task.date === '2026-09-03' ? { ...task, doneAmount: 0, isCompleted: false } : task,
    );
    const streak = computeStreak([plan], tasks, '2026-09-05');
    expect(streak.current).toBe(2); // 09-04, 09-05
    expect(streak.longest).toBe(2);
  });

  it('今日が未達成でも連続は途切れない', () => {
    const streak = computeStreak([plan], tasksCompletedThrough('2026-09-04'), '2026-09-05');
    expect(streak.current).toBe(4);
  });

  it('休養日は連続を途切れさせない', () => {
    const restSunday = {
      ...plan,
      weekdaySettings: createDefaultWeekdaySettings().map((s) =>
        s.dayOfWeek === 0 ? { ...s, isRestDay: true } : s,
      ),
    };
    // 2026-09-06 は日曜(休養日)。前後を達成していれば連続は続く。
    const tasks = generateTasks(restSunday).map((task) =>
      task.date <= '2026-09-08' ? { ...task, doneAmount: task.plannedAmount, isCompleted: true } : task,
    );
    const streak = computeStreak([plan], tasks, '2026-09-08');
    expect(streak.current).toBe(7); // 09-01〜09-05, 09-07, 09-08
  });

  it('予備日も連続を途切れさせない', () => {
    const buffered = { ...plan, bufferRatio: 0.25 };
    const tasks = generateTasks(buffered).map((task) =>
      task.kind === 'study' ? { ...task, doneAmount: task.plannedAmount, isCompleted: true } : task,
    );
    const streak = computeStreak([plan], tasks, '2026-09-10');
    expect(streak.current).toBe(tasks.filter((task) => task.kind === 'study').length);
  });

  it('最長記録は過去の連続も見る', () => {
    const tasks = tasksCompletedThrough('2026-09-10').map((task) =>
      task.date === '2026-09-08' ? { ...task, doneAmount: 0, isCompleted: false } : task,
    );
    const streak = computeStreak([plan], tasks, '2026-09-10');
    expect(streak.longest).toBe(7); // 09-01〜09-07
    expect(streak.current).toBe(2); // 09-09, 09-10
  });

  it('直近のカレンダーを指定日数ぶん返す', () => {
    const streak = computeStreak([plan], tasksCompletedThrough('2026-09-05'), '2026-09-05', 7);
    expect(streak.recent).toHaveLength(7);
    expect(streak.recent.at(-1)?.date).toBe('2026-09-05');
    expect(streak.recent.at(0)?.date).toBe('2026-08-30');
  });

  it('タスクが無くても落ちない', () => {
    const streak = computeStreak([], [], '2026-09-05');
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(0);
  });

  it('プランが動いていない空白期間で連続が途切れる', () => {
    const older: Plan = { ...plan, id: 'old', startDate: '2026-05-01', endDate: '2026-05-05' };
    const recent: Plan = { ...plan, id: 'new', startDate: '2026-09-01', endDate: '2026-09-10' };
    const tasks = [
      ...generateTasks(older).map((t) => ({ ...t, doneAmount: t.plannedAmount, isCompleted: true })),
      ...generateTasks(recent).map((t) =>
        t.date <= '2026-09-02' ? { ...t, doneAmount: t.plannedAmount, isCompleted: true } : t,
      ),
    ];
    const streak = computeStreak([older, recent], tasks, '2026-09-02');
    expect(streak.current).toBe(2); // 5月の5日連続は数えない
    expect(streak.longest).toBe(5);
  });

  it('予備日に実績を入れただけでは達成にならない', () => {
    const buffered: Plan = { ...plan, bufferRatio: 0.5 };
    const tasks = generateTasks(buffered).map((task) =>
      task.kind === 'buffer' ? { ...task, doneAmount: 1 } : task,
    );
    const streak = computeStreak([buffered], tasks, '2026-09-10');
    expect(streak.current).toBe(0);
    expect(streak.achievedDays).toBe(0);
  });

  it('複数プランのうち1つでも未達成なら達成にならない', () => {
    const other: Plan = { ...plan, id: 'plan-2' };
    const tasks = [
      ...tasksCompletedThrough('2026-09-05'),
      ...generateTasks(other),
    ];
    const streak = computeStreak([plan, other], tasks, '2026-09-05');
    expect(streak.current).toBe(0);
  });
});

describe('computeDayCompletion', () => {
  const other: Plan = { ...plan, id: 'plan-2', title: '数学' };

  /** 同じ日に2件のタスクがある状態を作る (量は 10 と 50 で差をつける) */
  function twoPlanTasks(): Task[] {
    return [
      ...generateTasks(plan),
      ...generateTasks({ ...other, totalAmount: 500 }),
    ];
  }

  it('件数の割合で出す(量の大小に引きずられない)', () => {
    const tasks = twoPlanTasks().map((task) =>
      task.planId === 'plan-1' && task.date === '2026-09-01'
        ? { ...task, doneAmount: task.plannedAmount, isCompleted: true }
        : task,
    );
    const result = computeDayCompletion(tasks, '2026-09-01');
    // 量で見れば 10/60 だが、件数では 1/2
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.ratio).toBe(0.5);
  });

  it('すべて終えれば 1 になる', () => {
    const tasks = twoPlanTasks().map((task) =>
      task.date === '2026-09-01'
        ? { ...task, doneAmount: task.plannedAmount, isCompleted: true }
        : task,
    );
    expect(computeDayCompletion(tasks, '2026-09-01').ratio).toBe(1);
  });

  it('実績が計画量に届いていれば完了扱いにする', () => {
    const tasks = generateTasks(plan).map((task) =>
      task.date === '2026-09-01' ? { ...task, doneAmount: task.plannedAmount } : task,
    );
    expect(computeDayCompletion(tasks, '2026-09-01').completed).toBe(1);
  });

  it('一部だけ進んだタスクは完了に数えない', () => {
    const tasks = generateTasks(plan).map((task) =>
      task.date === '2026-09-01' ? { ...task, doneAmount: 1 } : task,
    );
    const result = computeDayCompletion(tasks, '2026-09-01');
    expect(result.completed).toBe(0);
    expect(result.ratio).toBe(0);
  });

  it('予備日と休養日は数えない', () => {
    const buffered = { ...plan, bufferRatio: 0.5 };
    const tasks = generateTasks(buffered);
    const bufferDate = tasks.find((task) => task.kind === 'buffer')?.date;
    expect(bufferDate).toBeDefined();
    expect(computeDayCompletion(tasks, bufferDate!)).toEqual({
      total: 0,
      completed: 0,
      ratio: 0,
    });
  });

  it('タスクが無い日は 0 件・0%', () => {
    expect(computeDayCompletion(generateTasks(plan), '2030-01-01')).toEqual({
      total: 0,
      completed: 0,
      ratio: 0,
    });
  });
});

describe('computePace', () => {
  it('昨日までの計画を基準にするので、初日はまだ遅れにならない', () => {
    const pace = computePace(plan, generateTasks(plan), '2026-09-01');
    expect(pace.expectedAmount).toBe(0);
    expect(pace.delta).toBe(0);
    expect(pace.isBehind).toBe(false);
  });

  it('昨日までを終えていれば差は 0', () => {
    const pace = computePace(plan, tasksCompletedThrough('2026-09-04'), '2026-09-05');
    expect(pace.expectedAmount).toBe(40);
    expect(pace.doneAmount).toBe(40);
    expect(pace.delta).toBe(0);
    expect(pace.isBehind).toBe(false);
  });

  it('遅れを検出する', () => {
    const pace = computePace(plan, tasksCompletedThrough('2026-09-02'), '2026-09-05');
    expect(pace.delta).toBe(-20);
    expect(pace.isBehind).toBe(true);
    expect(pace.remainingAmount).toBe(80);
  });

  it('先取りしていれば貯金になる', () => {
    const pace = computePace(plan, tasksCompletedThrough('2026-09-08'), '2026-09-05');
    expect(pace.delta).toBe(40);
    expect(pace.isBehind).toBe(false);
  });
});

describe('findUncheckedTasks', () => {
  it('過ぎた日の未完了タスクだけを返す', () => {
    const unchecked = findUncheckedTasks(tasksCompletedThrough('2026-09-02'), '2026-09-05');
    expect(unchecked.map((task) => task.date)).toEqual(['2026-09-03', '2026-09-04']);
  });

  it('今日のタスクは対象外', () => {
    expect(findUncheckedTasks(generateTasks(plan), '2026-09-01')).toHaveLength(0);
  });

  it('確認済みにした日は出てこない', () => {
    const tasks = generateTasks(plan).map((task) =>
      task.date === '2026-09-03' ? { ...task, checkedAt: '2026-09-05' } : task,
    );
    const unchecked = findUncheckedTasks(tasks, '2026-09-05');
    expect(unchecked.map((task) => task.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
  });

  it('古すぎる日は出てこない', () => {
    // 既定では直近14日ぶんだけを見る
    expect(findUncheckedTasks(generateTasks(plan), '2030-01-01')).toHaveLength(0);
  });

  it('予備日は確認の対象外', () => {
    const buffered = { ...plan, bufferRatio: 0.5 };
    const unchecked = findUncheckedTasks(generateTasks(buffered), '2026-09-10');
    expect(unchecked.every((task) => task.kind === 'study')).toBe(true);
  });
});

describe('rescheduleFrom', () => {
  it('遅れた分を残りの日に配り直す', () => {
    // 09-01〜09-03 の 30 をやらないまま 09-04 を迎えた
    const tasks = generateTasks(plan);
    const result = rescheduleFrom(plan, tasks, '2026-09-04');
    expect(result.remainingAmount).toBe(100);
    // 残り 7 日に 100 → 1日 15 (切り上げ)
    expect(result.maxDailyAmount).toBe(15);
    const future = result.tasks.filter((task) => task.date >= '2026-09-04');
    expect(sumBy(future, (task) => task.plannedAmount)).toBe(100);
  });

  it('過去の記録を残す', () => {
    const tasks = tasksCompletedThrough('2026-09-03');
    const result = rescheduleFrom(plan, tasks, '2026-09-04');
    const past = result.tasks.filter((task) => task.date < '2026-09-04');
    expect(past).toHaveLength(3);
    expect(sumBy(past, (task) => task.doneAmount)).toBe(30);
    expect(result.remainingAmount).toBe(70);
  });

  it('終わっていれば残りの日を予備日にする', () => {
    const tasks = tasksCompletedThrough('2026-09-10');
    const result = rescheduleFrom(plan, tasks, '2026-09-05');
    expect(result.remainingAmount).toBe(0);
    const future = result.tasks.filter((task) => task.date > '2026-09-05');
    expect(future.every((task) => task.kind === 'buffer' && task.plannedAmount === 0)).toBe(true);
  });

  it('今日の分を終えていれば翌日から配り直す(今日に二重で割り当てない)', () => {
    const tasks = tasksCompletedThrough('2026-09-01');
    const result = rescheduleFrom(plan, tasks, '2026-09-01');
    const todayTask = result.tasks.find((task) => task.date === '2026-09-01');
    expect(todayTask?.doneAmount).toBe(10);
    expect(todayTask?.plannedAmount).toBe(10); // 実績で確定し、追加の割り当ては入らない
    const future = result.tasks.filter((task) => task.date > '2026-09-01');
    expect(sumBy(future, (task) => task.plannedAmount)).toBe(90);
  });

  it('残り期間に学習日が無くても例外を投げない', () => {
    // 日曜だけ学習するプランで、最後の日曜を過ぎてから配り直す
    const sundayOnly: Plan = {
      ...plan,
      startDate: '2026-09-01',
      endDate: '2026-09-09',
      weekdaySettings: createDefaultWeekdaySettings().map((s) => ({
        ...s,
        weight: s.dayOfWeek === 0 ? 1 : 0,
      })),
    };
    const result = rescheduleFrom(sundayOnly, generateTasks(sundayOnly), '2026-09-08');
    expect(result.hasNoRoom).toBe(true);
    expect(result.tasks.every((task) => task.date < '2026-09-08' || task.kind === 'buffer')).toBe(
      true,
    );
  });

  it('再計画すると遅れ表示が解消され、これから取り組む量が残量と一致する', () => {
    const tasks = generateTasks(plan); // 何もやっていない
    expect(shouldSuggestReschedule(plan, tasks, '2026-09-06')).toBe(true);

    const result = rescheduleFrom(plan, tasks, '2026-09-06');
    expect(shouldSuggestReschedule(plan, result.tasks, '2026-09-06')).toBe(false);
    expect(computePace(plan, result.tasks, '2026-09-06').delta).toBe(0);
    // 確定した過去は「やった量」で数えるので、昨日までの計画は 0 になる
    expect(expectedAmountBefore(result.tasks, '2026-09-06')).toBe(0);
    // これから取り組む量が総量と一致する
    const future = result.tasks.filter((task) => task.date >= '2026-09-06');
    expect(sumBy(future, (task) => task.plannedAmount)).toBe(100);
  });

  it('再計画しても、できなかった日の履歴は残る', () => {
    const tasks = generateTasks(plan).map((task) =>
      ['2026-09-01', '2026-09-02'].includes(task.date)
        ? { ...task, doneAmount: 10, isCompleted: true }
        : task,
    );
    const result = rescheduleFrom(plan, tasks, '2026-09-05');
    const records = collectDayRecords(result.tasks);
    expect(records.get('2026-09-01')?.status).toBe('achieved');
    expect(records.get('2026-09-03')?.status).toBe('missed');
    // 未達成の日が「予定の無い日」に化けて連続記録が水増しされない
    const streak = computeStreak([plan], result.tasks, '2026-09-05');
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(2);
  });

  it('繰り返し呼んでも結果が安定する', () => {
    let tasks = generateTasks(plan);
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const result = rescheduleFrom(plan, tasks, '2026-09-06');
      tasks = result.tasks;
      runs.push(result.maxDailyAmount);
    }
    expect(new Set(runs).size).toBe(1);
    expect(shouldSuggestReschedule(plan, tasks, '2026-09-06')).toBe(false);
    const future = tasks.filter((task) => task.date >= '2026-09-06');
    expect(sumBy(future, (task) => task.plannedAmount)).toBe(100);
  });

  it('期間が終わっていれば計画量を作らない', () => {
    const result = rescheduleFrom(plan, generateTasks(plan), '2026-10-01');
    expect(result.tasks.every((task) => task.date <= '2026-09-10')).toBe(true);
    expect(result.finishDate).toBeNull();
  });

  it('開始前でも全期間に配り直せる', () => {
    const result = rescheduleFrom(plan, generateTasks(plan), '2026-08-01');
    expect(result.tasks).toHaveLength(10);
    expect(sumBy(result.tasks, (task) => task.plannedAmount)).toBe(100);
  });

  it('他のプランのタスクには触らない', () => {
    const other: Task = {
      id: 'plan-2-2026-09-05',
      planId: 'plan-2',
      date: '2026-09-05',
      kind: 'study',
      plannedAmount: 5,
      doneAmount: 5,
      isCompleted: true,
      checkedAt: null,
      supersededAt: null,
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const result = rescheduleFrom(plan, [...generateTasks(plan), other], '2026-09-04');
    expect(result.tasks.every((task) => task.planId === 'plan-1')).toBe(true);
  });
});

describe('shouldSuggestReschedule', () => {
  it('遅れているときだけ提案する', () => {
    expect(shouldSuggestReschedule(plan, generateTasks(plan), '2026-09-05')).toBe(true);
    expect(shouldSuggestReschedule(plan, tasksCompletedThrough('2026-09-04'), '2026-09-05')).toBe(
      false,
    );
  });

  it('完了していれば提案しない', () => {
    expect(shouldSuggestReschedule(plan, tasksCompletedThrough('2026-09-10'), '2026-09-05')).toBe(
      false,
    );
  });

  it('期間が終わっていれば提案しない', () => {
    expect(shouldSuggestReschedule(plan, generateTasks(plan), '2026-10-01')).toBe(false);
  });
});
