import { Link } from 'react-router-dom';
import type { PlanProgress } from '../hooks/usePlans';
import ProgressBar from './ProgressBar';
import { formatShort } from '../lib/date';
import { formatAmount, formatPercent } from '../lib/format';

type Props = {
  progress: PlanProgress;
  /** 今日時点の遅れ(負) / 貯金(正) */
  delta?: number;
};

export default function PlanCard({ progress, delta }: Props) {
  const { plan, doneAmount, ratio, bufferDayCount } = progress;
  const isFinished = doneAmount >= plan.totalAmount;

  return (
    <Link
      to={`/plans/${plan.id}`}
      className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">{plan.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatShort(plan.startDate)} 〜 {formatShort(plan.endDate)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
            isFinished ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-700'
          }`}
        >
          {isFinished ? '達成' : formatPercent(ratio)}
        </span>
      </div>

      <ProgressBar ratio={ratio} className="mt-3" tone={isFinished ? 'emerald' : 'indigo'} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          {formatAmount(doneAmount, plan.unit)} / {formatAmount(plan.totalAmount, plan.unit)}
        </span>
        {bufferDayCount > 0 && <span>予備日 {bufferDayCount}日</span>}
        {delta !== undefined && delta !== 0 && (
          <span className={delta > 0 ? 'font-medium text-emerald-600' : 'font-medium text-amber-600'}>
            {delta > 0
              ? `${formatAmount(delta, plan.unit)} 貯金`
              : `${formatAmount(-delta, plan.unit)} 遅れ`}
          </span>
        )}
      </div>
    </Link>
  );
}
