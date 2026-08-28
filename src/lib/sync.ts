import type { AppData, Plan, PlanDeletion, Task } from '../types';
import { CURRENT_DATA_VERSION } from '../types';

/**
 * 2つの端末のデータを1つにまとめる。
 *
 * 単純に「新しいほうのファイルで上書き」にすると、片方の端末で付けた今日のチェックが
 * まるごと消えてしまう。そこで次の2段階でマージする。
 *
 *   1. プラン単位: updatedAt が新しいほうを採用する。プランの設定 (期間・量・曜日) と、
 *      そのプランが持つ「タスクの並び」(日付・計画量・予備日か) は、採用したほうに従う。
 *      再計画のようにタスクだけを組み直す操作でも updatedAt を進めているので、
 *      組み直した結果が古い並びに巻き戻ることはない。
 *   2. 記録単位: 各タスクの実績 (doneAmount / isCompleted / checkedAt / supersededAt) は、
 *      タスクごとに updatedAt が新しいほうを採用する。
 *      これにより「A端末で計画を組み直し、B端末で今日の分をやった」が両方残る。
 *
 * 削除したプランは deletions に記録が残る。削除より後に更新されたプランは復活させ、
 * それ以外は削除を優先する。
 *
 * この関数は純粋で、引数を書き換えない。同じ入力なら順序を入れ替えても同じ結果になる。
 */
export function mergeAppData(a: AppData, b: AppData): AppData {
  const deletions = mergeDeletions(a.deletions, b.deletions);
  const deletedAtByPlan = new Map(deletions.map((d) => [d.planId, d.deletedAt]));

  const plansById = new Map<string, { plan: Plan; from: AppData }>();
  for (const source of [a, b]) {
    for (const plan of source.plans) {
      const current = plansById.get(plan.id);
      if (current === undefined || isBetterPlan(plan, current.plan)) {
        plansById.set(plan.id, { plan, from: source });
      }
    }
  }

  const plans: Plan[] = [];
  const tasks: Task[] = [];
  for (const { plan, from } of plansById.values()) {
    // 削除後に更新されていなければ、削除を尊重する。
    const deletedAt = deletedAtByPlan.get(plan.id);
    if (deletedAt !== undefined && !isNewer(plan.updatedAt, deletedAt)) continue;

    plans.push(plan);
    tasks.push(...mergePlanTasks(plan.id, from.tasks, a.tasks, b.tasks));
  }

  // 生き残ったプランの削除記録はもう不要。
  const alivePlanIds = new Set(plans.map((plan) => plan.id));
  return {
    version: CURRENT_DATA_VERSION,
    plans: plans.sort(byCreatedAt),
    tasks: tasks.sort(byPlanThenDate),
    deletions: deletions.filter((deletion) => !alivePlanIds.has(deletion.planId)),
  };
}

/**
 * あるプランのタスクを組み立てる。
 * 並び (どの日にどれだけの計画量があるか) は、採用したプランが持っていたものを使う。
 * 実績は、同じ id のタスクのうち updatedAt が新しいほうから取る。
 */
function mergePlanTasks(
  planId: string,
  authoritative: Task[],
  aTasks: Task[],
  bTasks: Task[],
): Task[] {
  const recordById = new Map<string, Task>();
  for (const task of [...aTasks, ...bTasks]) {
    if (task.planId !== planId) continue;
    const current = recordById.get(task.id);
    if (current === undefined || isBetterRecord(task, current)) {
      recordById.set(task.id, task);
    }
  }

  return authoritative
    .filter((task) => task.planId === planId)
    .map((task) => {
      const record = recordById.get(task.id);
      if (record === undefined || record === task) return task;
      return {
        ...task,
        doneAmount: record.doneAmount,
        isCompleted: task.kind === 'study' && record.isCompleted,
        checkedAt: record.checkedAt,
        supersededAt: record.supersededAt,
        updatedAt: record.updatedAt,
      };
    });
}

function mergeDeletions(a: PlanDeletion[], b: PlanDeletion[]): PlanDeletion[] {
  const byPlan = new Map<string, PlanDeletion>();
  for (const deletion of [...a, ...b]) {
    const current = byPlan.get(deletion.planId);
    if (current === undefined || isNewer(deletion.deletedAt, current.deletedAt)) {
      byPlan.set(deletion.planId, deletion);
    }
  }
  return [...byPlan.values()].sort((x, y) => x.planId.localeCompare(y.planId));
}

function isNewer(left: string, right: string): boolean {
  return left > right;
}

/**
 * どちらの記録を採用するか。基本は更新時刻が新しいほう。
 *
 * 時刻が同じときは「記録が多いほう」を選ぶ。v1 から移行したデータや、
 * 生成直後で時刻を持たないタスクどうしがぶつかったときに、
 * 引数の順序で結果が変わったり、実際にやった記録が消えたりしないようにするため。
 */
function isBetterRecord(candidate: Task, current: Task): boolean {
  if (candidate.updatedAt !== current.updatedAt) {
    return isNewer(candidate.updatedAt, current.updatedAt);
  }
  if (candidate.doneAmount !== current.doneAmount) {
    return candidate.doneAmount > current.doneAmount;
  }
  if (candidate.isCompleted !== current.isCompleted) return candidate.isCompleted;
  if (candidate.checkedAt !== current.checkedAt) {
    return (candidate.checkedAt ?? '') > (current.checkedAt ?? '');
  }
  if (candidate.supersededAt !== current.supersededAt) {
    return (candidate.supersededAt ?? '') > (current.supersededAt ?? '');
  }
  return false;
}

/**
 * どちらのプランを採用するか。基本は更新時刻が新しいほう。
 * 時刻が同じときは中身を文字列にして比べ、順序に依存しない決着をつける。
 */
function isBetterPlan(candidate: Plan, current: Plan): boolean {
  if (candidate.updatedAt !== current.updatedAt) {
    return isNewer(candidate.updatedAt, current.updatedAt);
  }
  return stableStringify(candidate) > stableStringify(current);
}

/**
 * オブジェクトのキーを並べ替えてから JSON にする。
 *
 * 同じ内容でもキーの並びは作られ方で変わる (アプリが組み立てたものと、
 * サーバーから受け取って読み直したもので違う)。素の JSON.stringify で比べると
 * 中身が同じでも「変わった」と判定してしまい、保存 → 同期 → 保存 と止まらなくなる。
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 2つのデータが内容として同じか。キーや配列の作られ方の違いは無視する。 */
export function isSameAppData(a: AppData, b: AppData): boolean {
  return stableStringify(a) === stableStringify(b);
}

function byCreatedAt(a: Plan, b: Plan): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function byPlanThenDate(a: Task, b: Task): number {
  return a.planId.localeCompare(b.planId) || a.date.localeCompare(b.date);
}

/** 同期状態の保存先。データ本体とは別のキーに置く。 */
export type SyncSettings = {
  /** 同期サーバーの URL (末尾スラッシュなし)。未設定なら同期しない。 */
  apiBase: string;
  /** 同期コード。これを知っている端末どうしがデータを共有する。 */
  code: string;
  /** 最後にサーバーと同期できた時刻 (ISO 8601)。一度もしていなければ null。 */
  lastSyncedAt: string | null;
};

const SYNC_KEY = 'studyschedule.sync';

export function emptySyncSettings(): SyncSettings {
  return { apiBase: '', code: '', lastSyncedAt: null };
}

export function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return emptySyncSettings();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptySyncSettings();
    const value = parsed as Record<string, unknown>;
    return {
      apiBase: typeof value.apiBase === 'string' ? value.apiBase.replace(/\/+$/, '') : '',
      code: typeof value.code === 'string' ? value.code : '',
      lastSyncedAt: typeof value.lastSyncedAt === 'string' ? value.lastSyncedAt : null,
    };
  } catch {
    return emptySyncSettings();
  }
}

export function saveSyncSettings(settings: SyncSettings): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('同期設定の保存に失敗しました', error);
  }
}

/** 同期の準備ができているか (サーバーURLと同期コードの両方がある)。 */
export function isSyncConfigured(settings: SyncSettings): boolean {
  return settings.apiBase !== '' && settings.code !== '';
}
