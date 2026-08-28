import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppData, Plan, Task } from '../types';
import { CURRENT_DATA_VERSION } from '../types';
import { emptyData, load, save } from '../storage';
import { generateTasks } from '../lib/taskGenerator';
import { sumBy } from '../lib/amount';

export type PlanDraft = Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>;

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * アプリ全体のデータ(プランとタスク)を1か所で持ち、更新のたびに
 * localStorage へ保存する。タスクはプラン保存時に必ず再生成されるため、
 * プランとタスクの整合はこのフックの中だけで担保される。
 *
 * 更新はすべて「直前の状態を受け取って次の状態を返す」形にしてある。
 * 1つの操作の中で続けて2回更新しても、片方が捨てられることがない。
 */
export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    setData(load());
    setIsLoaded(true);
  }, []);

  const update = useCallback((reduce: (previous: AppData) => AppData) => {
    setData((previous) => {
      const next = reduce(previous);
      setSaveFailed(!save(next));
      return next;
    });
  }, []);

  const createPlan = useCallback(
    (draft: PlanDraft): Plan => {
      const now = new Date().toISOString();
      const plan: Plan = { ...draft, id: createId(), createdAt: now, updatedAt: now };
      const tasks = generateTasks(plan);
      update((previous) => ({
        ...previous,
        version: CURRENT_DATA_VERSION,
        plans: [...previous.plans, plan],
        tasks: [...previous.tasks, ...tasks],
      }));
      return plan;
    },
    [update],
  );

  const updatePlan = useCallback(
    (planId: string, draft: PlanDraft) => {
      update((previous) => {
        const existing = previous.plans.find((plan) => plan.id === planId);
        if (!existing) return previous;
        // タスクの組み方が変わるので、同期で「新しいほう」と判断されるよう時刻を進める。
        const plan: Plan = { ...existing, ...draft, updatedAt: new Date().toISOString() };
        // 既存の実績は同じ日付のタスクに引き継ぐ。
        const tasks = generateTasks(plan, previous.tasks);
        return {
          ...previous,
          version: CURRENT_DATA_VERSION,
          plans: previous.plans.map((item) => (item.id === planId ? plan : item)),
          tasks: [...previous.tasks.filter((task) => task.planId !== planId), ...tasks],
        };
      });
    },
    [update],
  );

  const deletePlan = useCallback(
    (planId: string) => {
      update((previous) => ({
        ...previous,
        version: CURRENT_DATA_VERSION,
        plans: previous.plans.filter((plan) => plan.id !== planId),
        tasks: previous.tasks.filter((task) => task.planId !== planId),
        // 他の端末から復活しないよう、削除したことを記録に残す。
        deletions: [
          ...previous.deletions.filter((deletion) => deletion.planId !== planId),
          { planId, deletedAt: new Date().toISOString() },
        ],
      }));
    },
    [update],
  );

  const updateTask = useCallback(
    (
      taskId: string,
      changes: Partial<Pick<Task, 'doneAmount' | 'isCompleted' | 'checkedAt'>>,
    ) => {
      const now = new Date().toISOString();
      update((previous) => ({
        ...previous,
        tasks: previous.tasks.map((task) =>
          task.id === taskId ? { ...task, ...changes, updatedAt: now } : task,
        ),
      }));
    },
    [update],
  );

  /**
   * あるプランのタスクをまとめて置き換える。再計画で使う。
   * タスクの組み方が変わるので、プランの updatedAt も進める。
   */
  const replaceTasks = useCallback(
    (planId: string, tasks: Task[]) => {
      const now = new Date().toISOString();
      update((previous) => ({
        ...previous,
        plans: previous.plans.map((plan) =>
          plan.id === planId ? { ...plan, updatedAt: now } : plan,
        ),
        tasks: [...previous.tasks.filter((task) => task.planId !== planId), ...tasks],
      }));
    },
    [update],
  );

  /** 指定したタスクをまとめて書き換える。1回の更新で完結する。 */
  const patchTasks = useCallback(
    (taskIds: Set<string>, changes: (task: Task) => Partial<Task>) => {
      const now = new Date().toISOString();
      update((previous) => ({
        ...previous,
        tasks: previous.tasks.map((task) =>
          taskIds.has(task.id) ? { ...task, ...changes(task), updatedAt: now } : task,
        ),
      }));
    },
    [update],
  );

  const replaceAll = useCallback((next: AppData) => update(() => next), [update]);

  return {
    data,
    isLoaded,
    saveFailed,
    createPlan,
    updatePlan,
    deletePlan,
    updateTask,
    replaceTasks,
    patchTasks,
    replaceAll,
  };
}

export type AppDataApi = ReturnType<typeof useAppData>;

/** プラン単位の進捗集計。一覧・詳細・ダッシュボードで共通に使う。 */
export type PlanProgress = {
  plan: Plan;
  tasks: Task[];
  doneAmount: number;
  /** 0〜1 */
  ratio: number;
  studyDayCount: number;
  bufferDayCount: number;
  finishDate: string | null;
};

export function summarizePlan(plan: Plan, tasks: Task[]): PlanProgress {
  const planTasks = tasks
    .filter((task) => task.planId === plan.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const doneAmount = sumBy(planTasks, (task) => task.doneAmount);
  const studyTasks = planTasks.filter((task) => task.kind === 'study' && task.plannedAmount > 0);
  return {
    plan,
    tasks: planTasks,
    doneAmount,
    ratio: plan.totalAmount > 0 ? Math.min(1, doneAmount / plan.totalAmount) : 0,
    studyDayCount: studyTasks.length,
    bufferDayCount: planTasks.length - studyTasks.length,
    finishDate: studyTasks.at(-1)?.date ?? null,
  };
}

export function usePlanProgress(data: AppData): PlanProgress[] {
  return useMemo(
    () =>
      data.plans
        .map((plan) => summarizePlan(plan, data.tasks))
        .sort((a, b) => a.plan.endDate.localeCompare(b.plan.endDate)),
    [data],
  );
}
