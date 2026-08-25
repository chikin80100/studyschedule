import type { Plan, Task } from '../types';
import { buildSchedule, validateScheduleInput } from './taskGenerator';
import { addDays, today as todayString } from './date';
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
  /** 残り期間に学習日が無く、配り直せなかった */
  hasNoRoom: boolean;
};

/**
 * 過ぎた日のタスクを「記録」に変える。
 *
 * 再計画したあとも旧計画の未達分が残っていると、いつまでも「遅れています」と
 * 言われ続け、計画量の合計も総量を超えてしまう。配り直した時点で過去の日の
 * 計画量は実績で確定させ、確認済みにする。実績が 0 の日は 0 のまま残るので、
 * 連続達成記録の履歴(その日は達成できなかった)は失われない。
 */
function settlePastTasks(tasks: Task[], asOf: string): Task[] {
  return tasks.map((task) =>
    task.kind === 'study'
      ? { ...task, plannedAmount: task.doneAmount, checkedAt: task.checkedAt ?? asOf }
      : { ...task, checkedAt: task.checkedAt ?? asOf },
  );
}

function toBufferTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({
    ...task,
    kind: 'buffer' as const,
    plannedAmount: 0,
    isCompleted: false,
  }));
}

/**
 * 進捗に合わせて計画を修正する。
 *
 * 過ぎた日のタスクは記録として残し、fromDate 以降だけを「まだ終わっていない量」で
 * 配り直す。遅れているときは残り日数に押し込むので1日の量が増え、前倒しで進んでいる
 * ときは減る。予備日の割合と切り上げ単位はプランの設定をそのまま使う。
 *
 * fromDate の分をすでに終えているときは、その日に二重で割り当てないよう翌日から配る。
 */
export function rescheduleFrom(
  plan: Plan,
  tasks: Task[],
  fromDate = todayString(),
): RescheduleResult {
  const planTasks = tasks.filter((task) => task.planId === plan.id);

  // 今日の分が終わっていれば翌日から。終わっていなければ今日から配り直す。
  const todayTask = planTasks.find((task) => task.date === fromDate);
  const base = todayTask?.kind === 'study' && todayTask.isCompleted ? addDays(fromDate, 1) : fromDate;
  const start = base > plan.startDate ? base : plan.startDate;

  const past = settlePastTasks(
    planTasks.filter((task) => task.date < start),
    fromDate,
  );
  const future = planTasks.filter((task) => task.date >= start);

  const doneAmount = sumBy(planTasks, (task) => task.doneAmount);
  const remainingAmount = roundAmount(Math.max(0, plan.totalAmount - doneAmount));

  const remainingInput = {
    startDate: start,
    endDate: plan.endDate,
    totalAmount: remainingAmount,
    weekdaySettings: plan.weekdaySettings,
    bufferRatio: plan.bufferRatio,
    roundingStep: plan.roundingStep,
  };

  // 期間が終わっている / 残量が無い / 残り期間に学習日が1日も無い場合は、
  // 配り直さずに先の日をすべて予備日にする。ここで例外を投げると画面が落ちる。
  const cannotSchedule =
    start > plan.endDate || remainingAmount <= 0 || validateScheduleInput(remainingInput) !== null;
  if (cannotSchedule) {
    return {
      tasks: [...past, ...toBufferTasks(future)],
      remainingAmount,
      affectedDays: future.length,
      maxDailyAmount: 0,
      finishDate: null,
      hasNoRoom: remainingAmount > 0,
    };
  }

  const schedule = buildSchedule(remainingInput);
  const previousByDate = new Map(future.map((task) => [task.date, task]));
  const rebuilt: Task[] = schedule.entries.map((entry) => {
    const previous = previousByDate.get(entry.date);
    return {
      id: previous?.id ?? `${plan.id}-${entry.date}`,
      planId: plan.id,
      date: entry.date,
      kind: entry.kind,
      plannedAmount: entry.plannedAmount,
      doneAmount: previous?.doneAmount ?? 0,
      isCompleted: entry.kind === 'study' && (previous?.doneAmount ?? 0) >= entry.plannedAmount,
      checkedAt: previous?.checkedAt ?? null,
    };
  });

  // 学習しない日で実績のある日は記録として残す。
  const rebuiltDates = new Set(rebuilt.map((task) => task.date));
  const salvaged = future
    .filter((task) => task.doneAmount > 0 && !rebuiltDates.has(task.date))
    .map((task) => ({ ...task, kind: 'buffer' as const, plannedAmount: 0, isCompleted: false }));

  return {
    tasks: [...past, ...rebuilt, ...salvaged].sort((a, b) => a.date.localeCompare(b.date)),
    remainingAmount,
    affectedDays: rebuilt.length,
    maxDailyAmount: schedule.maxDailyAmount,
    finishDate: schedule.finishDate,
    hasNoRoom: false,
  };
}

/** 再計画を提案すべきか。今日より前の計画量に対して実績が足りていないとき。 */
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
