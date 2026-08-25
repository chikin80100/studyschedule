import type { DayStatus, StreakSummary } from '../lib/progress';
import { WEEKDAY_LABELS } from '../types';
import { dayOfWeek, formatShort } from '../lib/date';

const STATUS_STYLE: Record<DayStatus, string> = {
  achieved: 'bg-emerald-500 text-white',
  partial: 'bg-amber-300 text-amber-900',
  missed: 'bg-rose-200 text-rose-700',
  none: 'bg-slate-100 text-slate-400',
  idle: 'bg-slate-50 text-slate-300',
};

const STATUS_LABEL: Record<DayStatus, string> = {
  achieved: '達成',
  partial: '一部できた',
  missed: '未達成',
  none: '休養日・予備日',
  idle: '予定なし',
};

export default function StreakCard({ streak }: { streak: StreakSummary }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">連続達成記録</h2>
        <span className="text-xs text-slate-400">達成 {streak.achievedDays}日</span>
      </div>

      <div className="mt-3 flex items-end gap-5">
        <p className="flex items-baseline gap-1">
          <span aria-hidden className="text-2xl">
            {streak.current > 0 ? '🔥' : '🌱'}
          </span>
          <span className="text-3xl font-bold tabular-nums text-slate-900">{streak.current}</span>
          <span className="text-sm text-slate-500">日連続</span>
        </p>
        <div className="pb-1">
          <p className="text-xs text-slate-400">最長記録</p>
          <p className="text-lg font-semibold tabular-nums text-slate-700">{streak.longest}日</p>
        </div>
      </div>

      <div className="mt-4">
        <ul className="flex flex-wrap gap-1">
          {streak.recent.map((record) => (
            <li
              key={record.date}
              aria-label={`${formatShort(record.date)} ${STATUS_LABEL[record.status]}`}
              title={`${formatShort(record.date)} ${STATUS_LABEL[record.status]}`}
              className={`flex size-7 items-center justify-center rounded-md text-[10px] font-bold ${STATUS_STYLE[record.status]}`}
            >
              <span aria-hidden>{WEEKDAY_LABELS[dayOfWeek(record.date)]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          直近3週間。休養日と予備日は連続記録を途切れさせません。
        </p>
      </div>
    </section>
  );
}
