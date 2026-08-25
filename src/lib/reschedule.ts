import type { Plan, Task } from '../types';
import { buildSchedule } from './taskGenerator';
import { today as todayString } from './date';
import { roundAmount, sumBy } from './amount';

export type RescheduleResult = {
  tasks: Task[];
  /** 残り期間に配り直した量 */
  remainingAmount: number;
  /** 配り直した対象の日数 */
  affectedDays: number;
  /** 再計画後の1日あたり最大量 */
  maxDailyAmount: number;
  finishDate: string | null;
};

/**
 * 進捗に合わせて計画を修正する。
 *
 * 過ぎた日のタスクは記録として残し、fromDate 以降だけを「まだ終わっていない量」で
 * 配り直す。遅れているときは残り日数に押し込むので1日の量が増え、前倒しで進んでいる
 * ときは減る。予備日の割合と切り上げ単位はプランの設定をそのまま使う。
 */
export function rescheduleFrom(
  plan: Plan,
  tasks: Task[],
  fromDate = todayString(),
): RescheduleResult {
  const planTasks = tasks.filter((task) => task.planId === plan.id);
  const start = fromDate > plan.startDate ? fromDate : plan.startDate;
  const past = planTasks.filter((task) => task.date < start);
  const future = planTasks.filter((task) => task.date >= start);

  const doneAmount = sumBy(planTasks, (task) => task.doneAmount);
  const remainingAmount = roundAmount(Math.max(0, plan.totalAmount - doneAmount));

  // 期間が終わっている、または残量が無いなら、先の日はすべて予備日にする。
  if (start > plan.endDate || remainingAmount <= 0) {
    return {
      tasks: [
        ...past,
        ...future.map((task) => ({ ...task, kind: 'buffer' as const, plannedAmount: 0 })),
      ],
      remainingAmount,
      affectedDays: future.length,
      maxDailyAmount: 0,
      finishDate: null,
    };
  }

  const schedule = buildSchedule({
    startDate: start,
    endDate: plan.endDate,
    totalAmount: remainingAmount,
    weekdaySettings: plan.weekdaySettings,
    bufferRatio: plan.bufferRatio,
    roundingStep: plan.roundingStep,
  });

  const previousByDate = new Map(future.map((task) => [task.date, task]));
  const rebuilt = schedule.entries.map((entry) => {
    const previous = previousByDate.get(entry.date);
    return {
      id: previous?.id ?? `${plan.id}-${entry.date}`,
      planId: plan.id,
      date: entry.date,
      kind: entry.kind,
      plannedAmount: entry.plannedAmount,
      doneAmount: previous?.doneAmount ?? 0,
      isCompleted:
        entry.plannedAmount > 0 ? (previous?.doneAmount ?? 0) >= entry.plannedAmount : false,
    } satisfies Task;
  });

  return {
    tasks: [...past, ...rebuilt],
    remainingAmount,
    affectedDays: rebuilt.length,
    maxDailyAmount: schedule.maxDailyAmount,
    finishDate: schedule.finishDate,
  };
}

/** 再計画を提案すべきか。今日までの計画量に対して実績が足りていないとき。 */
export function shouldSuggestReschedule(
  plan: Plan,
  tasks: Task[],
  today = todayString(),
): boolean {
  if (today > plan.endDate) return false;
  const planTasks = tasks.filter((task) => task.planId === plan.id);
  const expected = sumBy(
    planTasks.filter((task) => task.date < today),
    (task) => task.plannedAmount,
  );
  const done = sumBy(planTasks, (task) => task.doneAmount);
  if (done >= plan.totalAmount) return false;
  return roundAmount(done - expected) < 0;
}
