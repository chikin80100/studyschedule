import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AppDataApi } from '../hooks/usePlans';
import { summarizePlan } from '../hooks/usePlans';
import { computePace } from '../lib/progress';
import { rescheduleFrom } from '../lib/reschedule';
import { formatMonth, formatShort, today as todayString } from '../lib/date';
import { formatAmount, formatPercent } from '../lib/format';
import ProgressBar from '../components/ProgressBar';
import TaskItem from '../components/TaskItem';

export default function PlanDetail({ api }: { api: AppDataApi }) {
  const { planId } = useParams();
  const navigate = useNavigate();
  const today = todayString();
  const [message, setMessage] = useState<string | null>(null);

  const plan = api.data.plans.find((item) => item.id === planId);
  const progress = useMemo(
    () => (plan ? summarizePlan(plan, api.data.tasks) : null),
    [plan, api.data.tasks],
  );

  if (!plan || !progress) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">プランが見つかりませんでした。</p>
        <Link to="/plans" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline">
          プラン一覧へ
        </Link>
      </div>
    );
  }

  const pace = computePace(plan, api.data.tasks, today);

  const groups = new Map<string, typeof progress.tasks>();
  for (const task of progress.tasks) {
    const key = formatMonth(task.date);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  const handleReschedule = () => {
    const result = rescheduleFrom(plan, api.data.tasks, today);
    api.replaceAll({
      ...api.data,
      tasks: [...api.data.tasks.filter((task) => task.planId !== plan.id), ...result.tasks],
    });
    setMessage(
      result.remainingAmount <= 0
        ? 'すべて完了しているため、残りの日は予備日にしました。'
        : `残り ${formatAmount(result.remainingAmount, plan.unit)} を ${result.affectedDays}日に配り直しました(1日 最大 ${formatAmount(result.maxDailyAmount, plan.unit)})。`,
    );
  };

  const handleDelete = () => {
    if (!window.confirm(`「${plan.title}」とその記録をすべて削除します。よろしいですか?`)) return;
    api.deletePlan(plan.id);
    navigate('/plans');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold text-slate-900">{plan.title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatShort(plan.startDate)} 〜 {formatShort(plan.endDate)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to={`/plans/${plan.id}/edit`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            編集
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
          >
            削除
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-500">
            {formatAmount(progress.doneAmount, plan.unit)} /{' '}
            {formatAmount(plan.totalAmount, plan.unit)}
          </span>
          <span className="text-lg font-bold tabular-nums text-indigo-600">
            {formatPercent(progress.ratio)}
          </span>
        </div>
        <ProgressBar
          ratio={progress.ratio}
          className="mt-2"
          tone={progress.ratio >= 1 ? 'emerald' : 'indigo'}
        />

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">昨日までの計画</dt>
            <dd className="font-semibold text-slate-900">
              {formatAmount(pace.expectedAmount, plan.unit)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">貯金 / 遅れ</dt>
            <dd
              className={`font-semibold ${
                pace.delta > 0 ? 'text-emerald-600' : pace.delta < 0 ? 'text-amber-600' : 'text-slate-900'
              }`}
            >
              {pace.delta > 0 ? '+' : ''}
              {formatAmount(pace.delta, plan.unit)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">残り</dt>
            <dd className="font-semibold text-slate-900">
              {formatAmount(pace.remainingAmount, plan.unit)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">残りの予備日</dt>
            <dd className="font-semibold text-slate-900">{pace.remainingBufferDays}日</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={handleReschedule}
          className="mt-4 w-full rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
        >
          進捗に合わせて残りを配り直す
        </button>
      </section>

      <section className="space-y-4">
        {[...groups.entries()].map(([month, tasks]) => (
          <div key={month}>
            <h3 className="mb-2 text-sm font-semibold text-slate-600">{month}</h3>
            <ul className="space-y-2">
              {tasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  plan={plan}
                  showDate
                  onChange={(changes) => api.updateTask(task.id, changes)}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
