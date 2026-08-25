import type { Plan, RoundingStep, Task, TaskKind, WeekdaySetting } from '../types';
import { dayOfWeek, diffDays, eachDate, isValidDateString } from './date';

/** 生成に必要な最小限の入力。プラン保存前のプレビューでも使えるようにしている。 */
export type ScheduleInput = Pick<
  Plan,
  'startDate' | 'endDate' | 'totalAmount' | 'weekdaySettings' | 'bufferRatio' | 'roundingStep'
>;

export type ScheduleEntry = {
  date: string;
  kind: TaskKind;
  plannedAmount: number;
};

export type Schedule = {
  entries: ScheduleEntry[];
  /** 計画量が割り当てられた日数 */
  studyDayCount: number;
  /** 予備日の日数(末尾に確保した分 + 切り上げにより前倒しで空いた分) */
  bufferDayCount: number;
  /** 学習しない日数(休養日、および量の比率が 0 の曜日) */
  offDayCount: number;
  /** 実際に使われた切り上げ単位 */
  step: number;
  /** 1日あたりの計画量の最大値 */
  maxDailyAmount: number;
  /**
   * 計画量の合計。丸め誤差を挟まずに算出した値で、totalAmount と一致する
   * (総量に小数7桁以上が入っていた場合は、6桁に丸めた値と一致する)。
   */
  plannedTotal: number;
  /** 最後に計画量が入る日。study 日が無ければ null。 */
  finishDate: string | null;
};

/** 現実的な上限。打ち間違いで数百万日分を生成してフリーズするのを防ぐ。 */
export const MAX_SPAN_DAYS = 3650;
export const MAX_TOTAL_AMOUNT = 1e9;
const MIN_DATE = '1900-01-01';
const MAX_DATE = '2999-12-31';
/** 小数は 6 桁まで扱う。それ以上は丸める。 */
export const MAX_DECIMALS = 6;
/** これ未満の総量は最小単位に届かず配分できない。 */
export const MIN_TOTAL_AMOUNT = 1 / 10 ** MAX_DECIMALS;

function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = `${value}`;
  if (text.includes('e') || text.includes('E')) return MAX_DECIMALS;
  return Math.min(MAX_DECIMALS, (text.split('.')[1] ?? '').length);
}

/** value を step の倍数に切り上げる(整数の世界で計算する用)。 */
function ceilToInt(value: number, step: number): number {
  // 1e-9 は「ちょうど倍数」が浮動小数点誤差で1段上に繰り上がるのを防ぐための許容幅。
  return Math.ceil(value / step - 1e-9) * step;
}

/**
 * 1日あたりの平均量から「キリのいい」切り上げ単位を選ぶ。
 * 8.33ページ/日 のような扱いにくい端数を 9ページ/日 に均すのが狙い。
 * 重みに偏りがある場合は日ごとの量が平均から離れるが、目安としてはこれで足りる。
 */
export function resolveStep(roundingStep: RoundingStep, averagePerDay: number): number {
  if (typeof roundingStep === 'number' && Number.isFinite(roundingStep) && roundingStep > 0) {
    return roundingStep;
  }
  if (averagePerDay >= 100) return 10;
  if (averagePerDay >= 20) return 5;
  if (averagePerDay >= 3) return 1;
  if (averagePerDay >= 0.5) return 0.5;
  return 0.1;
}

function settingFor(weekdaySettings: WeekdaySetting[], date: string): WeekdaySetting | undefined {
  return weekdaySettings.find((setting) => setting.dayOfWeek === dayOfWeek(date));
}

/** 学習する日か。休養日と、量の比率が 0 の曜日は対象外。 */
function isActiveDate(weekdaySettings: WeekdaySetting[], date: string): boolean {
  const setting = settingFor(weekdaySettings, date);
  return setting !== undefined && !setting.isRestDay && setting.weight > 0;
}

/**
 * 入力の不備を日本語のメッセージで返す。問題なければ null。
 * フォームの検証、生成処理、保存データの読み込みのすべてから呼ぶ。
 */
export function validateScheduleInput(input: ScheduleInput): string | null {
  if (!isValidDateString(input.startDate)) return '開始日を入力してください。';
  if (!isValidDateString(input.endDate)) return '終了日を入力してください。';
  if (input.startDate < MIN_DATE || input.endDate > MAX_DATE) {
    return `日付は ${MIN_DATE} 〜 ${MAX_DATE} の範囲で指定してください。`;
  }
  if (input.endDate < input.startDate) return '終了日は開始日以降にしてください。';
  if (diffDays(input.startDate, input.endDate) + 1 > MAX_SPAN_DAYS) {
    return `期間が長すぎます。${MAX_SPAN_DAYS}日以内にしてください。`;
  }
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) {
    return '総量は 0 より大きい数値で入力してください。';
  }
  if (input.totalAmount > MAX_TOTAL_AMOUNT) {
    return `総量は ${MAX_TOTAL_AMOUNT} 以下で入力してください。`;
  }
  if (input.totalAmount < MIN_TOTAL_AMOUNT) {
    return `総量は ${MIN_TOTAL_AMOUNT} 以上で入力してください。`;
  }
  if (
    input.roundingStep !== 'auto' &&
    (!Number.isFinite(input.roundingStep) || input.roundingStep <= 0)
  ) {
    return '1日の量の単位は 0 より大きい数値で指定してください。';
  }
  if (input.weekdaySettings.length !== 7) return '曜日設定が不正です。';
  const days = new Set(input.weekdaySettings.map((setting) => setting.dayOfWeek));
  if (days.size !== 7 || [...days].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return '曜日設定が不正です。';
  }
  if (
    input.weekdaySettings.some((setting) => !Number.isFinite(setting.weight) || setting.weight < 0)
  ) {
    return '曜日ごとの量は 0 以上の数値で入力してください。';
  }
  if (!Number.isFinite(input.bufferRatio) || input.bufferRatio < 0 || input.bufferRatio > 0.5) {
    return '予備日の割合は 0〜50% の範囲で指定してください。';
  }

  const hasActiveDate = eachDate(input.startDate, input.endDate).some((date) =>
    isActiveDate(input.weekdaySettings, date),
  );
  if (!hasActiveDate) {
    return '学習する日がありません。休養日を減らすか、いずれかの曜日に 1 以上の量を設定してください。';
  }
  return null;
}

/**
 * 期間・総量・曜日設定から日ごとの計画を組み立てる。
 *
 * キッチリ割り切ると端数が出て取り組みにくく、1日の遅れが計画全体に響くため、
 * 2種類の「余白」を入れている。
 *   1. 期間の末尾 bufferRatio 分を予備日として空ける(遅れの受け皿)。
 *   2. 1日あたりの量をキリのいい単位に切り上げる(前倒しで終わり、末尾がさらに空く)。
 * 切り上げた分は最終日で総量ちょうどに切り詰めるので、計画量の合計は totalAmount と一致する。
 *
 * 配分は浮動小数点の誤差を避けるため、いったん整数(最小単位の個数)に直して計算する。
 */
export function buildSchedule(input: ScheduleInput): Schedule {
  const error = validateScheduleInput(input);
  if (error) throw new Error(error);

  const dates = eachDate(input.startDate, input.endDate);
  const activeDates = dates.filter((date) => isActiveDate(input.weekdaySettings, date));

  // 1つ目の余白: 末尾を予備日として確保する。作業日は最低1日残す。
  // n * ratio は 62.999... のような誤差を出すため、いったん丸めてから切り捨てる。
  const reservedBufferDays = Math.min(
    activeDates.length - 1,
    Math.floor(Math.round(activeDates.length * input.bufferRatio * 1e6) / 1e6),
  );
  const workDates = activeDates.slice(0, activeDates.length - reservedBufferDays);

  // 学習しない曜日は activeDates から除いてあるので、重みは必ず正になる。
  const weights = workDates.map((date) => settingFor(input.weekdaySettings, date)?.weight ?? 0);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  // 2つ目の余白: 1日あたりをキリのいい数に切り上げる。
  const step = resolveStep(input.roundingStep, input.totalAmount / workDates.length);

  // 最小単位を 1 とする整数の世界に移す。以降の加減算に誤差が乗らない。
  const scale = 10 ** Math.max(decimalsOf(input.totalAmount), decimalsOf(step));
  const totalUnits = Math.round(input.totalAmount * scale);
  const stepUnits = Math.max(1, Math.round(step * scale));

  const unitsByDate = new Map<string, number>();
  let remainingUnits = totalUnits;
  for (const [index, date] of workDates.entries()) {
    if (remainingUnits <= 0) break;
    const raw = (totalUnits * weights[index]) / totalWeight;
    const units = Math.min(ceilToInt(raw, stepUnits), remainingUnits);
    if (units <= 0) continue;
    unitsByDate.set(date, units);
    remainingUnits -= units;
  }

  const activeDateSet = new Set(activeDates);
  const entries: ScheduleEntry[] = [];
  for (const date of dates) {
    if (!activeDateSet.has(date)) continue; // 休養日・量0の曜日はタスクを作らない
    const units = unitsByDate.get(date) ?? 0;
    entries.push({
      date,
      kind: units > 0 ? 'study' : 'buffer',
      plannedAmount: units / scale,
    });
  }

  const studyEntries = entries.filter((entry) => entry.kind === 'study');
  return {
    entries,
    studyDayCount: studyEntries.length,
    bufferDayCount: entries.length - studyEntries.length,
    offDayCount: dates.length - activeDates.length,
    step,
    maxDailyAmount: studyEntries.reduce((max, entry) => Math.max(max, entry.plannedAmount), 0),
    plannedTotal: (totalUnits - remainingUnits) / scale,
    finishDate: studyEntries.at(-1)?.date ?? null,
  };
}

/**
 * プランからタスクを生成する。previousTasks を渡すと、同じ日付の実績
 * (doneAmount / isCompleted) を引き継ぐ。プラン編集時に記録を極力残すため。
 *
 * 予備日には計画量が無いので完了フラグは引き継がず、実績量だけを残す。
 * 曜日設定の変更で学習しない日になった日も、実績が入っていれば予備日として残す
 * (「土曜を休養日にしたら土曜にやった分が消えた」を防ぐ)。
 */
export function generateTasks(plan: Plan, previousTasks: Task[] = []): Task[] {
  const schedule = buildSchedule(plan);
  const planTasks = previousTasks.filter((task) => task.planId === plan.id);
  const previousByDate = new Map(planTasks.map((task) => [task.date, task]));

  const tasks: Task[] = schedule.entries.map((entry) => {
    const previous = previousByDate.get(entry.date);
    return {
      id: `${plan.id}-${entry.date}`,
      planId: plan.id,
      date: entry.date,
      kind: entry.kind,
      plannedAmount: entry.plannedAmount,
      doneAmount: previous?.doneAmount ?? 0,
      isCompleted: entry.kind === 'study' && previous?.isCompleted === true,
      checkedAt: previous?.checkedAt ?? null,
    };
  });

  // 学習しない日になったが実績のある日を、記録として拾い直す。
  const generatedDates = new Set(tasks.map((task) => task.date));
  const salvaged = planTasks.filter(
    (task) =>
      task.doneAmount > 0 &&
      !generatedDates.has(task.date) &&
      task.date >= plan.startDate &&
      task.date <= plan.endDate,
  );
  for (const task of salvaged) {
    tasks.push({ ...task, kind: 'buffer', plannedAmount: 0, isCompleted: false });
  }

  return tasks.sort((a, b) => a.date.localeCompare(b.date));
}
