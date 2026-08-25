import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppDataApi } from '../hooks/usePlans';
import { usePlanProgress } from '../hooks/usePlans';
import { useToday } from '../hooks/useToday';
import { computePace, computeStreak, findUncheckedTasks } from '../lib/progress';
import { rescheduleFrom, shouldSuggestReschedule } from '../lib/reschedule';
import { formatLong } from '../lib/date';
import { formatAmount } from '../lib/format';
import { sumBy } from '../lib/amount';
import TaskItem from '../components/TaskItem';
import StreakCard from '../components/StreakCard';
import ProgressBar from '../components/ProgressBar';

export default function Dashboard({ api }: { api: AppDataApi }) {
  const today = useToday();
  const progresses = usePlanProgress(api.data);
  const [message, setMessage] = useState<string | null>(null);

  const streak = useMemo(
    () => computeStreak(api.data.plans, api.data.tasks, today),
    [api.data.plans, api.data.tasks, today],
  );
  const uncheckedTasks = useMemo(
    () => findUncheckedTasks(api.data.tasks, today),
    [api.data.tasks, today],
  );
  const todayTasks = useMemo(
    () => api.data.tasks.filter((task) => task.date === today),
    [api.data.tasks, today],
  );

  const planById = useMemo(
    () => new Map(api.data.plans.map((plan) => [plan.id, plan])),
    [api.data.plans],
  );

  const behindPlans = useMemo(
    () => api.data.plans.filter((plan) => shouldSuggestReschedule(plan, api.data.tasks, today)),
    [api.data.plans, api.data.tasks, today],
  );

  const activePlansToday = api.data.plans.filter(
    (plan) => plan.startDate <= today && today <= plan.endDate,
  );

  const todayPlanned = sumBy(todayTasks, (task) => task.plannedAmount);
  const todayDone = sumBy(todayTasks, (task) => Math.min(task.doneAmount, task.plannedAmount));
  const todayRatio = todayPlanned > 0 ? todayDone / todayPlanned : 0;
  const studyTasksToday = todayTasks.filter(
    (task) => task.kind === 'study' && task.plannedAmount > 0,
  );

  const applyReschedule = () => {
    const summaries: string[] = [];
    for (const plan of behindPlans) {
      const planTasks = api.data.tasks.filter((task) => task.planId === plan.id);
      const result = rescheduleFrom(plan, planTasks, today);
      api.replaceTasks(plan.id, result.tasks);
      summaries.push(
        result.hasNoRoom
          ? `${plan.title}: 残り ${formatAmount(result.remainingAmount, plan.unit)} を入れる学習日が残っていません。期間か曜日設定を見直してください。`
          : `${plan.title}: 残り ${formatAmount(result.remainingAmount, plan.unit)} を ${result.affectedDays}日に配り直しました(1日 最大 ${formatAmount(result.maxDailyAmount, plan.unit)})`,
      );
    }
    setMessage(summaries.join(' / ') || '修正するプランがありませんでした。');
  };

  const markUnchecked = (mode: 'done' | 'missed') => {
    const targets = new Set(uncheckedTasks.map((task) => task.id));
    if (targets.size === 0) return;
    api.patchTasks(targets, (task) =>
      mode === 'done'
        ? {
            doneAmount: Math.max(task.doneAmount, task.plannedAmount),
            isCompleted: true,
            checkedAt: today,
          }
        : { isCompleted: false, checkedAt: today },
    );
    setMessage(
      mode === 'done'
        ? `${targets.size}日分を完了として記録しました。`
        : `${targets.size}日分を「できなかった」として確認しました。必要なら計画を修正しましょう。`,
    );
  };

  if (api.data.plans.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-4xl" aria-hidden>
          📚
        </p>
        <h2 className="mt-3 font-semibold text-slate-800">まずはプランを作りましょう</h2>
        <p className="mt-1 text-sm text-slate-500">
          学習内容・期間・総量を入力すると、1日ごとのタスクが自動で作られます。
        </p>
        <Link
          to="/plans/new"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          プランを作る
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-slate-400">{formatLong(today)}</p>
        <h2 className="mt-0.5 text-xl font-bold text-slate-900">今日のタスク</h2>
      </div>

      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800">
          <span className="flex-1">{message}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="shrink-0 px-1 text-indigo-400 hover:text-indigo-600"
            aria-label="通知を閉じる"
          >
            ✕
          </button>
        </div>
      )}

      {uncheckedTasks.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            未確認の日が {uncheckedTasks.length} 件あります
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            過ぎた日で完了になっていないタスクです。実際にできたかどうかを記録しましょう。
          </p>
          <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
            {uncheckedTasks.map((task) => {
              const plan = planById.get(task.planId);
              if (!plan) return null;
              return (
                <TaskItem
                  key={task.id}
                  task={task}
                  plan={plan}
                  showDate
                  onChange={(changes) => api.updateTask(task.id, changes)}
                />
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => markUnchecked('done')}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              すべてできた
            </button>
            <button
              type="button"
              onClick={() => markUnchecked('missed')}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              できなかった(確認済みにする)
            </button>
          </div>
        </section>
      )}

      {behindPlans.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="text-sm font-semibold text-rose-900">計画より遅れています</h3>
          <ul className="mt-2 space-y-1 text-xs text-rose-800">
            {behindPlans.map((plan) => {
              const pace = computePace(plan, api.data.tasks, today);
              return (
                <li key={plan.id}>
                  {plan.title}: {formatAmount(-pace.delta, plan.unit)} の遅れ / 残り{' '}
                  {formatAmount(pace.remainingAmount, plan.unit)}・{pace.remainingDays}日
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={applyReschedule}
            className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700"
          >
            残りを今日から配り直す
          </button>
          <p className="mt-2 text-[11px] text-rose-700">
            まだ終わっていない量を今日以降に配り直します。過去の記録は残ります。
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">今日の達成率</h3>
          <span className="text-sm font-bold tabular-nums text-indigo-600">
            {Math.round(todayRatio * 100)}%
          </span>
        </div>
        <ProgressBar ratio={todayRatio} className="mt-2" tone={todayRatio >= 1 ? 'emerald' : 'indigo'} />

        {studyTasksToday.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            {todayTasks.length > 0
              ? '今日は予備日です。遅れの挽回や先取りに使えます。'
              : activePlansToday.length > 0
                ? '今日は休養日です。ゆっくり休みましょう。'
                : '今日のタスクはありません。'}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {todayTasks.map((task) => {
              const plan = planById.get(task.planId);
              if (!plan) return null;
              return (
                <TaskItem
                  key={task.id}
                  task={task}
                  plan={plan}
                  onChange={(changes) => api.updateTask(task.id, changes)}
                />
              );
            })}
          </ul>
        )}
      </section>

      <StreakCard streak={streak} />

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">プランの進捗</h3>
          <Link to="/plans" className="text-xs font-medium text-indigo-600 hover:underline">
            すべて見る
          </Link>
        </div>
        <ul className="mt-2 space-y-2">
          {progresses.map((progress) => (
            <li key={progress.plan.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to={`/plans/${progress.plan.id}`}
                  className="truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                >
                  {progress.plan.title}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {formatAmount(progress.doneAmount, progress.plan.unit)} /{' '}
                  {formatAmount(progress.plan.totalAmount, progress.plan.unit)}
                </span>
              </div>
              <ProgressBar
                ratio={progress.ratio}
                className="mt-2"
                tone={progress.ratio >= 1 ? 'emerald' : 'indigo'}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
