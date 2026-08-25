import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AppDataApi, PlanDraft } from '../hooks/usePlans';
import type { RoundingStep, WeekdaySetting } from '../types';
import { createDefaultWeekdaySettings } from '../types';
import { buildSchedule, validateScheduleInput } from '../lib/taskGenerator';
import { addDays, formatShort } from '../lib/date';
import { useToday } from '../hooks/useToday';
import { roundAmount } from '../lib/amount';
import { formatAmount } from '../lib/format';
import WeekdayWeightEditor from '../components/WeekdayWeightEditor';

const BUFFER_OPTIONS = [
  { value: 0, label: 'なし' },
  { value: 0.1, label: '10%' },
  { value: 0.15, label: '15%' },
  { value: 0.25, label: '25%' },
] as const;

const STEP_OPTIONS: { value: RoundingStep; label: string }[] = [
  { value: 'auto', label: 'おまかせ' },
  { value: 0.5, label: '0.5' },
  { value: 1, label: '1' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
];

type FormState = {
  title: string;
  unit: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  weekdaySettings: WeekdaySetting[];
  bufferRatio: number;
  roundingStep: RoundingStep;
};

export default function PlanForm({ api }: { api: AppDataApi }) {
  const navigate = useNavigate();
  const today = useToday();
  const { planId } = useParams();
  const existing = planId ? api.data.plans.find((plan) => plan.id === planId) : undefined;
  const isEdit = Boolean(existing);

  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          title: existing.title,
          unit: existing.unit,
          startDate: existing.startDate,
          endDate: existing.endDate,
          totalAmount: `${existing.totalAmount}`,
          weekdaySettings: existing.weekdaySettings,
          bufferRatio: existing.bufferRatio,
          roundingStep: existing.roundingStep,
        }
      : {
          title: '',
          unit: 'ページ',
          startDate: today,
          endDate: addDays(today, 29),
          totalAmount: '',
          weekdaySettings: createDefaultWeekdaySettings(),
          bufferRatio: 0.15,
          roundingStep: 'auto',
        },
  );

  const patch = (changes: Partial<FormState>) => setForm((prev) => ({ ...prev, ...changes }));

  const draft: PlanDraft = {
    title: form.title.trim(),
    unit: form.unit.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    // 小数7桁以上は最小単位に収まらないので、入力の時点で丸める。
    totalAmount: roundAmount(Number(form.totalAmount) || 0),
    weekdaySettings: form.weekdaySettings,
    bufferRatio: form.bufferRatio,
    roundingStep: form.roundingStep,
  };

  const preview = useMemo(() => {
    const error = validateScheduleInput(draft);
    if (error) return { error, schedule: null };
    try {
      return { error: null, schedule: buildSchedule(draft) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '計画を作れませんでした。', schedule: null };
    }
    // draft は毎レンダー作り直されるので、依存は実際の値で指定する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.startDate,
    form.endDate,
    form.totalAmount,
    form.weekdaySettings,
    form.bufferRatio,
    form.roundingStep,
  ]);

  const titleError = draft.title === '' ? '学習内容を入力してください。' : null;
  const canSubmit = !preview.error && !titleError;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (isEdit && existing) {
      const ok = window.confirm(
        [
          '計画を作り直します。',
          '・同じ日付のタスクの実績は引き継がれます。',
          '・学習しない日(休養日・比率0)になった日も、実績があれば記録として残ります。',
          '・新しい期間の外になった日の記録は消えます。',
          'よろしいですか?',
        ].join('\n'),
      );
      if (!ok) return;
      api.updatePlan(existing.id, draft);
      navigate(`/plans/${existing.id}`);
    } else {
      const plan = api.createPlan(draft);
      navigate(`/plans/${plan.id}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-xl font-bold text-slate-900">{isEdit ? 'プランを編集' : 'プランを作る'}</h2>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">学習内容</span>
          <input
            type="text"
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="例: 数学の問題集"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">総量</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.totalAmount}
              onChange={(event) => patch({ totalAmount: event.target.value })}
              placeholder="300"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">単位</span>
            <input
              type="text"
              value={form.unit}
              onChange={(event) => patch({ unit: event.target.value })}
              placeholder="ページ / 問 / 分"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">開始日</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">終了日</span>
            <input
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={(event) => patch({ endDate: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">曜日ごとの配分</h3>
        <WeekdayWeightEditor
          value={form.weekdaySettings}
          onChange={(weekdaySettings) => patch({ weekdaySettings })}
        />
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">余白の設定</h3>
          <p className="mt-1 text-xs text-slate-500">
            キッチリ割り切らずに余裕を持たせます。遅れても挽回できる計画になります。
          </p>
        </div>

        <div>
          <span className="text-sm font-medium text-slate-700">末尾に残す予備日</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {BUFFER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ bufferRatio: option.value })}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  form.bufferRatio === option.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-sm font-medium text-slate-700">1日の量の単位</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {STEP_OPTIONS.map((option) => (
              <button
                key={`${option.value}`}
                type="button"
                onClick={() => patch({ roundingStep: option.value })}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  form.roundingStep === option.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            この単位に切り上げるので、8.33ページ/日 のような端数になりません。
          </p>
        </div>
      </section>

      <section
        className={`rounded-2xl border p-4 ${
          preview.error || titleError
            ? 'border-slate-200 bg-slate-50'
            : 'border-indigo-200 bg-indigo-50'
        }`}
      >
        <h3 className="text-sm font-semibold text-slate-700">できあがる計画</h3>
        {titleError && <p className="mt-2 text-sm text-rose-600">{titleError}</p>}
        {preview.error ? (
          <p className="mt-2 text-sm text-rose-600">{preview.error}</p>
        ) : (
          preview.schedule && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">1日あたり最大</dt>
                <dd className="font-semibold text-slate-900">
                  {formatAmount(preview.schedule.maxDailyAmount, draft.unit)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">学習する日</dt>
                <dd className="font-semibold text-slate-900">{preview.schedule.studyDayCount}日</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">予備日</dt>
                <dd className="font-semibold text-slate-900">{preview.schedule.bufferDayCount}日</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">学習しない日</dt>
                <dd className="font-semibold text-slate-900">{preview.schedule.offDayCount}日</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">完了見込み</dt>
                <dd className="font-semibold text-slate-900">
                  {preview.schedule.finishDate ? formatShort(preview.schedule.finishDate) : '—'}
                  {preview.schedule.finishDate && preview.schedule.finishDate < form.endDate && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                      予定より前倒し
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )
        )}
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isEdit ? '保存する' : 'この計画で作る'}
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
