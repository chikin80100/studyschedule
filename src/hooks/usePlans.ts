import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppData, Plan, Task } from '../types';
import { emptyData, load, save } from '../storage';
import { generateTasks } from '../lib/taskGenerator';
import { sumBy } from '../lib/amount';

export type PlanDraft = Omit<Plan, 'id' | 'createdAt'>;

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * アプリ全体のデータ(プランとタスク)を1か所で持ち、更新のたびに
 * localStorage へ保存する。タスクはプラン保存時に必ず再生成されるため、
 * プランとタスクの整合はこのフックの中だけで担保される。
 */
export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setData(load());
    setIsLoaded(true);
  }, []);

  const update = useCallback((next: AppData) => {
    setData(next);
    save(next);
  }, []);

  const createPlan = useCallback(
    (draft: PlanDraft): Plan => {
      const plan: Plan = { ...draft, id: createId(), createdAt: new Date().toISOString() };
      const tasks = generateTasks(plan);
      update({
        version: 1,
        plans: [...data.plans, plan],
        tasks: [...data.tasks, ...tasks],
      });
      return plan;
    },
    [data, update],
  );

  const updatePlan = useCallback(
    (planId: string, draft: PlanDraft) => {
      const existing = data.plans.find((plan) => plan.id === planId);
      if (!existing) return;
      const plan: Plan = { ...existing, ...draft };
      // 既存の実績は同じ日付のタスクに引き継ぐ。
      const previousTasks = data.tasks.filter((task) => task.planId === planId);
      const tasks = generateTasks(plan, previousTasks);
      update({
        version: 1,
        plans: data.plans.map((item) => (item.id === planId ? plan : item)),
        tasks: [...data.tasks.filter((task) => task.planId !== planId), ...tasks],
      });
    },
    [data, update],
  );

  const deletePlan = useCallback(
    (planId: string) => {
      update({
        version: 1,
        plans: data.plans.filter((plan) => plan.id !== planId),
        tasks: data.tasks.filter((task) => task.planId !== planId),
      });
    },
    [data, update],
  );

  const updateTask = useCallback(
    (taskId: string, changes: Partial<Pick<Task, 'doneAmount' | 'isCompleted'>>) => {
      update({
        ...data,
        tasks: data.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
      });
    },
    [data, update],
  );

  const replaceAll = useCallback((next: AppData) => update(next), [update]);

  return { data, isLoaded, createPlan, updatePlan, deletePlan, updateTask, replaceAll };
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
  const studyTasks = planTasks.filter((task) => task.kind === 'study');
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
