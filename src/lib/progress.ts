import type { Plan, Task } from '../types';
import { addDays, diffDays, today as todayString } from './date';
import { roundAmount, sumBy } from './amount';

/**
 * その日の取り組み状況。
 * - achieved: 計画量のある日をすべて終えた
 * - partial:  一部だけ進んだ
 * - missed:   計画量があったのに手つかず
 * - none:     休養日・予備日しかない日(記録の対象外。連続を途切れさせない)
 * - idle:     プランが1つも動いていない日(連続はここで途切れる)
 */
export type DayStatus = 'achieved' | 'partial' | 'missed' | 'none' | 'idle';

export type DayRecord = {
  date: string;
  status: DayStatus;
  plannedAmount: number;
  doneAmount: number;
};

/** その日を「終えた」とみなすか。計画量が 0 の日は対象外。 */
function isTaskDone(task: Task): boolean {
  if (task.kind !== 'study' || task.plannedAmount <= 0) return false;
  return task.isCompleted || task.doneAmount >= task.plannedAmount;
}

export type DayCompletion = {
  /** その日の計画があるタスクの数 */
  total: number;
  /** そのうち終わっているタスクの数 */
  completed: number;
  /** 0〜1。計画のあるタスクが無い日は 0。 */
  ratio: number;
};

/**
 * その日の達成率を「終えたタスク数 ÷ 計画のあるタスク数」で出す。
 * 量ではなく件数で見るので、量の大きいプランに引きずられず、
 * 「今日やることを何個片づけたか」がそのまま出る。
 * 予備日・休養日は計画が無いので数えない。
 */
export function computeDayCompletion(tasks: Task[], date: string): DayCompletion {
  const dayTasks = tasks.filter(
    (task) => task.date === date && task.kind === 'study' && task.plannedAmount > 0,
  );
  const completed = dayTasks.filter(isTaskDone).length;
  return {
    total: dayTasks.length,
    completed,
    ratio: dayTasks.length > 0 ? completed / dayTasks.length : 0,
  };
}

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

  // 計画量のある日だけを判定対象にする。予備日の自主学習は連続記録には数えない
  //(数えてしまうと「予備日に1だけ入れる」で記録が伸びてしまう)。
  const completedByDate = new Map<string, boolean>();
  for (const task of tasks) {
    if (task.kind !== 'study' || task.plannedAmount <= 0) continue;
    const previous = completedByDate.get(task.date);
    const done = isTaskDone(task);
    completedByDate.set(task.date, previous === undefined ? done : previous && done);
  }

  for (const record of records.values()) {
    const allCompleted = completedByDate.get(record.date);
    if (allCompleted === undefined) {
      record.status = 'none';
    } else if (allCompleted) {
      record.status = 'achieved';
    } else {
      record.status = record.doneAmount > 0 ? 'partial' : 'missed';
    }
  }
  return records;
}

/** その日にプランが1つでも動いていたか。 */
function isCoveredByPlan(plans: Plan[], date: string): boolean {
  return plans.some((plan) => plan.startDate <= date && date <= plan.endDate);
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
 * - プランが1つも動いていない日(何も予定が無かった期間)では連続が途切れる。
 * - 今日はまだ取り組み中の可能性があるため、未達成でも連続を途切れさせない。
 */
export function computeStreak(
  plans: Plan[],
  tasks: Task[],
  today = todayString(),
  recentDays = 21,
): StreakSummary {
  const records = collectDayRecords(tasks);
  const dates = [...records.keys()].filter((date) => date <= today).sort();
  const earliest = dates[0];

  const statusOf = (date: string): DayStatus => {
    const status = records.get(date)?.status;
    if (status) return status;
    return isCoveredByPlan(plans, date) ? 'none' : 'idle';
  };

  let current = 0;
  for (let cursor = today; earliest !== undefined && cursor >= earliest; cursor = addDays(cursor, -1)) {
    const status = statusOf(cursor);
    if (status === 'achieved') {
      current += 1;
      continue;
    }
    if (status === 'none') continue; // 休養日・予備日は素通り
    if (cursor === today) continue; // 今日はこれから達成できる
    break; // missed / partial / idle で途切れる
  }

  let longest = 0;
  let run = 0;
  let previousDate: string | null = null;
  for (const date of dates) {
    // 記録の無い日が挟まっていれば、その間にプランが動いていたかを見る。
    if (previousDate !== null) {
      for (let gap = addDays(previousDate, 1); gap < date; gap = addDays(gap, 1)) {
        if (statusOf(gap) === 'idle') {
          run = 0;
          break;
        }
      }
    }
    previousDate = date;

    const status = statusOf(date);
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
      records.get(date) ?? { date, status: statusOf(date), plannedAmount: 0, doneAmount: 0 },
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
  /** 明日以降に残っている予備日の数 */
  remainingBufferDays: number;
  /** 期間の残り日数(今日を含まない) */
  remainingDays: number;
  isBehind: boolean;
  isFinished: boolean;
};

/**
 * 指定日より前に終えているはずの量。
 * 再計画で確定した日 (supersededAt) は、旧計画ではなく実際にやった量で数える。
 * こうしないと、配り直したあとも古い未達分が遅れとして残り続けてしまう。
 */
export function expectedAmountBefore(tasks: Task[], today: string): number {
  return sumBy(
    tasks.filter((task) => task.date < today),
    (task) => (task.supersededAt === null ? task.plannedAmount : task.doneAmount),
  );
}

/** 今日時点で計画に対して進んでいるか遅れているかを出す。 */
export function computePace(plan: Plan, tasks: Task[], today = todayString()): PaceSummary {
  const planTasks = tasks.filter((task) => task.planId === plan.id);
  const expectedAmount = expectedAmountBefore(planTasks, today);
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

/** 毎日の確認でさかのぼる日数。これより古い日は確認リストに出さない。 */
export const CHECK_IN_LOOKBACK_DAYS = 14;

/**
 * 今日より前で、まだ「どうだったか」を確認していない計画日。
 * 何年も前の未完了タスクが延々と並ばないよう、直近の日数分だけを見る。
 */
export function findUncheckedTasks(
  tasks: Task[],
  today = todayString(),
  lookbackDays = CHECK_IN_LOOKBACK_DAYS,
): Task[] {
  const since = addDays(today, -lookbackDays);
  return tasks
    .filter(
      (task) =>
        task.kind === 'study' &&
        task.plannedAmount > 0 &&
        task.date < today &&
        task.date >= since &&
        task.checkedAt === null &&
        !task.isCompleted &&
        task.doneAmount < task.plannedAmount,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
