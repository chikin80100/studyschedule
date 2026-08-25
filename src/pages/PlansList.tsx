import { Link } from 'react-router-dom';
import type { AppDataApi } from '../hooks/usePlans';
import { usePlanProgress } from '../hooks/usePlans';
import { computePace } from '../lib/progress';
import { today as todayString } from '../lib/date';
import PlanCard from '../components/PlanCard';

export default function PlansList({ api }: { api: AppDataApi }) {
  const progresses = usePlanProgress(api.data);
  const today = todayString();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">プラン</h2>
        <Link
          to="/plans/new"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          + 新規作成
        </Link>
      </div>

      {progresses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          まだプランがありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {progresses.map((progress) => (
            <li key={progress.plan.id}>
              <PlanCard
                progress={progress}
                delta={computePace(progress.plan, api.data.tasks, today).delta}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
