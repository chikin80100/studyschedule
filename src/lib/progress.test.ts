import { describe, expect, it } from 'vitest';
import { computePace, computeStreak, findUncheckedTasks } from './progress';
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
    const streak = computeStreak(tasksCompletedThrough('2026-09-05'), '2026-09-05');
    expect(streak.current).toBe(5);
    expect(streak.longest).toBe(5);
    expect(streak.achievedDays).toBe(5);
  });

  it('未達成の日で連続が途切れる', () => {
    const tasks = tasksCompletedThrough('2026-09-05').map((task) =>
      task.date === '2026-09-03' ? { ...task, doneAmount: 0, isCompleted: false } : task,
    );
    const streak = computeStreak(tasks, '2026-09-05');
    expect(streak.current).toBe(2); // 09-04, 09-05
    expect(streak.longest).toBe(2);
  });

  it('今日が未達成でも連続は途切れない', () => {
    const streak = computeStreak(tasksCompletedThrough('2026-09-04'), '2026-09-05');
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
    const streak = computeStreak(tasks, '2026-09-08');
    expect(streak.current).toBe(7); // 09-01〜09-05, 09-07, 09-08
  });

  it('予備日も連続を途切れさせない', () => {
    const buffered = { ...plan, bufferRatio: 0.25 };
    const tasks = generateTasks(buffered).map((task) =>
      task.kind === 'study' ? { ...task, doneAmount: task.plannedAmount, isCompleted: true } : task,
    );
    const streak = computeStreak(tasks, '2026-09-10');
    expect(streak.current).toBe(tasks.filter((task) => task.kind === 'study').length);
  });

  it('最長記録は過去の連続も見る', () => {
    const tasks = tasksCompletedThrough('2026-09-10').map((task) =>
      task.date === '2026-09-08' ? { ...task, doneAmount: 0, isCompleted: false } : task,
    );
    const streak = computeStreak(tasks, '2026-09-10');
    expect(streak.longest).toBe(7); // 09-01〜09-07
    expect(streak.current).toBe(2); // 09-09, 09-10
  });

  it('直近のカレンダーを指定日数ぶん返す', () => {
    const streak = computeStreak(tasksCompletedThrough('2026-09-05'), '2026-09-05', 7);
    expect(streak.recent).toHaveLength(7);
    expect(streak.recent.at(-1)?.date).toBe('2026-09-05');
    expect(streak.recent.at(0)?.date).toBe('2026-08-30');
  });

  it('タスクが無くても落ちない', () => {
    const streak = computeStreak([], '2026-09-05');
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(0);
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
    const future = result.tasks.filter((task) => task.date >= '2026-09-05');
    expect(future.every((task) => task.kind === 'buffer' && task.plannedAmount === 0)).toBe(true);
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
