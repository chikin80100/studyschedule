import { useEffect, useState } from 'react';
import type { Plan, Task } from '../types';
import { formatShort } from '../lib/date';
import { formatAmount } from '../lib/format';

type Props = {
  task: Task;
  plan: Plan;
  /** 日付を出すか(ダッシュボードでは不要) */
  showDate?: boolean;
  onChange: (changes: Partial<Pick<Task, 'doneAmount' | 'isCompleted'>>) => void;
};

export default function TaskItem({ task, plan, showDate = false, onChange }: Props) {
  const [draft, setDraft] = useState(`${task.doneAmount}`);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(`${task.doneAmount}`);
  }, [task.doneAmount, isEditing]);

  const isBuffer = task.kind === 'buffer';
  const ratio = task.plannedAmount > 0 ? Math.min(1, task.doneAmount / task.plannedAmount) : 0;

  const commitDraft = () => {
    setIsEditing(false);
    const value = Math.max(0, Number(draft) || 0);
    onChange({
      doneAmount: value,
      isCompleted: task.plannedAmount > 0 && value >= task.plannedAmount,
    });
  };

  const toggleCompleted = () => {
    const next = !task.isCompleted;
    onChange({
      isCompleted: next,
      doneAmount: next ? Math.max(task.doneAmount, task.plannedAmount) : task.doneAmount,
    });
  };

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
        task.isCompleted
          ? 'border-emerald-200 bg-emerald-50/60'
          : isBuffer
            ? 'border-dashed border-slate-200 bg-slate-50'
            : 'border-slate-200 bg-white'
      }`}
    >
      {isBuffer ? (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-xs text-slate-400"
        >
          +
        </span>
      ) : (
        <button
          type="button"
          onClick={toggleCompleted}
          aria-label={task.isCompleted ? '完了を取り消す' : '完了にする'}
          aria-pressed={task.isCompleted}
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm transition ${
            task.isCompleted
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-slate-300 bg-white text-transparent hover:border-indigo-400'
          }`}
        >
          ✓
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {showDate && (
            <span className="text-xs font-medium text-slate-400">{formatShort(task.date)}</span>
          )}
          <span
            className={`truncate text-sm font-medium ${
              task.isCompleted ? 'text-emerald-800 line-through' : 'text-slate-800'
            }`}
          >
            {plan.title}
          </span>
          {isBuffer && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              予備日
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {isBuffer ? (
            <>計画なし・遅れの挽回に使えます</>
          ) : (
            <>
              目標 {formatAmount(task.plannedAmount, plan.unit)}
              <span className="mx-1 text-slate-300">/</span>
              実績 {formatAmount(task.doneAmount, plan.unit)}
            </>
          )}
        </p>
        {!isBuffer && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-indigo-400 transition-[width]"
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
        )}
      </div>

      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        aria-label={`${plan.title} の実績量`}
        value={draft}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
      />
    </li>
  );
}
