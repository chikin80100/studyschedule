import type { AppData, DayOfWeek, Plan, RoundingStep, Task, WeekdaySetting } from './types';
import { CURRENT_DATA_VERSION, DAYS_OF_WEEK, createDefaultWeekdaySettings } from './types';
import { isValidDateString } from './lib/date';
import { validateScheduleInput } from './lib/taskGenerator';

const STORAGE_KEY = 'studyschedule.v1';

export function emptyData(): AppData {
  return { version: CURRENT_DATA_VERSION, plans: [], tasks: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 数値、または数値として読める文字列を受け取る。他ツール由来の緩い JSON を拾うため。 */
function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function parseWeekdaySettings(value: unknown): WeekdaySetting[] {
  const defaults = createDefaultWeekdaySettings();
  if (!Array.isArray(value)) return defaults;
  return DAYS_OF_WEEK.map((dayOfWeek: DayOfWeek) => {
    const found = value.find((item) => isRecord(item) && item.dayOfWeek === dayOfWeek);
    if (!isRecord(found)) return defaults[dayOfWeek];
    return {
      dayOfWeek,
      isRestDay: found.isRestDay === true,
      weight: Math.max(0, asNumber(found.weight, 1)),
    };
  });
}

function parseRoundingStep(value: unknown): RoundingStep {
  if (value === 'auto') return 'auto';
  const step = asNumber(value, 0);
  return Number.isFinite(step) && step > 0 ? step : 'auto';
}

/**
 * 1件のプランを復元する。形が壊れているものに加えて、
 * 「読めるがタスクを生成できない」プラン(終了日が開始日より前など)も捨てる。
 * ここを通ったプランは必ず generateTasks に渡せる。
 */
function parsePlan(value: unknown): Plan | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id, '');
  const startDate = asString(value.startDate, '');
  const endDate = asString(value.endDate, '');
  if (!id || !isValidDateString(startDate) || !isValidDateString(endDate)) return null;

  const plan: Plan = {
    id,
    title: asString(value.title, '(無題)'),
    unit: asString(value.unit, ''),
    startDate,
    endDate,
    totalAmount: asNumber(value.totalAmount, 0),
    weekdaySettings: parseWeekdaySettings(value.weekdaySettings),
    bufferRatio: Math.min(0.5, Math.max(0, asNumber(value.bufferRatio, 0))),
    roundingStep: parseRoundingStep(value.roundingStep),
    createdAt: asString(value.createdAt, new Date().toISOString()),
  };

  return validateScheduleInput(plan) === null ? plan : null;
}

function parseTask(value: unknown, planIds: Set<string>): Task | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id, '');
  const planId = asString(value.planId, '');
  const date = asString(value.date, '');
  if (!id || !planIds.has(planId) || !isValidDateString(date)) return null;

  const kind = value.kind === 'buffer' ? 'buffer' : 'study';
  return {
    id,
    planId,
    date,
    kind,
    plannedAmount: kind === 'buffer' ? 0 : Math.max(0, asNumber(value.plannedAmount, 0)),
    doneAmount: Math.max(0, asNumber(value.doneAmount, 0)),
    isCompleted: kind === 'study' && value.isCompleted === true,
  };
}

export type ParseResult = {
  data: AppData;
  /** 入力に含まれていたプランの件数(壊れていて捨てたものを含む) */
  inputPlanCount: number;
  /** 捨てたプランの件数 */
  droppedPlanCount: number;
};

/**
 * localStorage / インポートされた JSON はいずれも外部入力として扱い、
 * 形が壊れていても落ちないように1件ずつ検証する。
 */
export function parseAppData(value: unknown): ParseResult {
  if (!isRecord(value) || !Array.isArray(value.plans)) {
    return { data: emptyData(), inputPlanCount: 0, droppedPlanCount: 0 };
  }
  const plans = value.plans.map(parsePlan).filter((plan): plan is Plan => plan !== null);
  const planIds = new Set(plans.map((plan) => plan.id));
  const tasks = Array.isArray(value.tasks)
    ? value.tasks
        .map((task) => parseTask(task, planIds))
        .filter((task): task is Task => task !== null)
    : [];

  return {
    data: { version: CURRENT_DATA_VERSION, plans, tasks },
    inputPlanCount: value.plans.length,
    droppedPlanCount: value.plans.length - plans.length,
  };
}

export function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return parseAppData(JSON.parse(raw)).data;
  } catch {
    return emptyData();
  }
}

export function save(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('データの保存に失敗しました', error);
  }
}

export function exportToJson(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * インポート用。読み込んだデータで既存データを置き換えるので、
 * 「このアプリのデータではない JSON」を黙って受け入れて全消しにしないよう厳しめに弾く。
 */
export function importFromJson(json: string): AppData {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.plans)) {
    throw new Error('StudySchedule のデータではないようです。');
  }
  const result = parseAppData(parsed);
  if (result.inputPlanCount > 0 && result.data.plans.length === 0) {
    throw new Error('プランを1件も読み込めませんでした。ファイルが壊れている可能性があります。');
  }
  return result.data;
}
