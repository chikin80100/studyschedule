import type { Plan, Task } from '../types';
import { addDays, diffDays, today as todayString } from './date';
import { roundAmount, sumBy } from './amount';

/** その日の取り組み状況。予備日・休養日しかない日は 'none'(記録の対象外)。 */
export type DayStatus = 'achieved' | 'partial' | 'missed' | 'none';

export type DayRecord = {
  date: string;
  status: DayStatus;
  plannedAmount: number;
  doneAmount: number;
};

/** 日付ごとに全プランのタスクをまとめる。 */
export function collectDayRecords(tasks: Task[]): Map<string, DayRecord> {
  const records = new Map<string, DayRecord>();
  for (const task of tasks) {
    const record = records.get(task.date) ?? {
      date: task.date,
      status: 'none' as DayStatus,
      plannedAmount: 0,
      doneAmount: 0,
    };
    record.plannedAmount = roundAmount(record.plannedAmount + task.plannedAmount);
    record.doneAmount = roundAmount(record.doneAmount + task.doneAmount);
    records.set(task.date, record);
  }

  const completedByDate = new Map<string, boolean>();
  for (const task of tasks) {
    if (task.kind !== 'study') continue;
    const previous = completedByDate.get(task.date);
    const done = task.isCompleted || task.doneAmount >= task.plannedAmount;
    completedByDate.set(task.date, previous === undefined ? done : previous && done);
  }

  for (const record of records.values()) {
    const allCompleted = completedByDate.get(record.date);
    if (allCompleted === undefined) {
      // 計画量のある日が無い = 休養日・予備日のみ。連続記録の判定対象にしない。
      record.status = record.doneAmount > 0 ? 'achieved' : 'none';
    } else if (allCompleted) {
      record.status = 'achieved';
    } else {
      record.status = record.doneAmount > 0 ? 'partial' : 'missed';
    }
  }
  return records;
}

export type StreakSummary = {
  /** 現在続いている連続達成日数 */
  current: number;
  /** 過去最長の連続達成日数 */
  longest: number;
  /** 直近 n 日分の状況(古い順)。カレンダー表示用。 */
  recent: DayRecord[];
  /** 達成した日の総数 */
  achievedDays: number;
};

/**
 * 連続達成記録を集計する。
 * - 計画量のある日をすべて完了させた日が「達成」。
 * - 休養日・予備日しかない日は連続を途切れさせず、日数にも数えない。
 * - 今日はまだ取り組み中の可能性があるため、未達成でも連続を途切れさせない。
 */
export function computeStreak(tasks: Task[], today = todayString(), recentDays = 21): StreakSummary {
  const records = collectDayRecords(tasks);
  const dates = [...records.keys()].filter((date) => date <= today).sort();

  let current = 0;
  for (let cursor = today; dates.length > 0 && cursor >= dates[0]; cursor = addDays(cursor, -1)) {
    const status = records.get(cursor)?.status ?? 'none';
    if (status === 'achieved') {
      current += 1;
      continue;
    }
    if (status === 'none') continue; // 休養日・予備日は素通り
    if (cursor === today) continue; // 今日はこれから達成できる
    break;
  }

  let longest = 0;
  let run = 0;
  for (const date of dates) {
    const status = records.get(date)?.status ?? 'none';
    if (status === 'achieved') {
      run += 1;
      longest = Math.max(longest, run);
    } else if (status !== 'none') {
      run = 0;
    }
  }
  longest = Math.max(longest, current);

  const recent: DayRecord[] = [];
  for (let i = recentDays - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    recent.push(
      records.get(date) ?? { date, status: 'none', plannedAmount: 0, doneAmount: 0 },
    );
  }

  return {
    current,
    longest,
    recent,
    achievedDays: dates.filter((date) => records.get(date)?.status === 'achieved').length,
  };
}

export type PaceSummary = {
  /** 昨日までに終えているはずの量。今日の分はこれから取り組むので含めない。 */
  expectedAmount: number;
  /** 実際に終えた量 */
  doneAmount: number;
  /** 正なら貯金、負なら遅れ */
  delta: number;
  /** 残りの量 */
  remainingAmount: number;
  /** 残っている予備日の数 */
  remainingBufferDays: number;
  /** 期間の残り日数(今日を含まない) */
  remainingDays: number;
  isBehind: boolean;
  isFinished: boolean;
};

/** 今日時点で計画に対して進んでいるか遅れているかを出す。 */
export function computePace(plan: Plan, tasks: Task[], today = todayString()): PaceSummary {
  const planTasks = tasks.filter((task) => task.planId === plan.id);
  const expectedAmount = sumBy(
    planTasks.filter((task) => task.date < today),
    (task) => task.plannedAmount,
  );
  const doneAmount = sumBy(planTasks, (task) => task.doneAmount);
  const remainingAmount = roundAmount(Math.max(0, plan.totalAmount - doneAmount));
  const remainingBufferDays = planTasks.filter(
    (task) => task.kind === 'buffer' && task.date > today,
  ).length;

  return {
    expectedAmount,
    doneAmount,
    delta: roundAmount(doneAmount - expectedAmount),
    remainingAmount,
    remainingBufferDays,
    remainingDays: Math.max(0, diffDays(today, plan.endDate)),
    isBehind: doneAmount < expectedAmount,
    isFinished: remainingAmount <= 0,
  };
}

/** 今日より前で、まだ完了確認をしていない計画日。デイリーチェックインの対象。 */
export function findUncheckedTasks(tasks: Task[], today = todayString()): Task[] {
  return tasks
    .filter(
      (task) =>
        task.kind === 'study' &&
        task.date < today &&
        !task.isCompleted &&
        task.doneAmount < task.plannedAmount,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
