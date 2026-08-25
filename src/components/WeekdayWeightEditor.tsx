import type { WeekdaySetting } from '../types';
import { WEEKDAY_LABELS } from '../types';

type Props = {
  value: WeekdaySetting[];
  onChange: (next: WeekdaySetting[]) => void;
};

/** 曜日ごとに休養日か、学習する場合の相対量(重み)かを設定する。 */
export default function WeekdayWeightEditor({ value, onChange }: Props) {
  const patch = (dayOfWeek: number, changes: Partial<WeekdaySetting>) => {
    onChange(
      value.map((setting) =>
        setting.dayOfWeek === dayOfWeek ? { ...setting, ...changes } : setting,
      ),
    );
  };

  const applyPreset = (preset: 'even' | 'weekday' | 'weekend') => {
    onChange(
      value.map((setting) => {
        const isWeekend = setting.dayOfWeek === 0 || setting.dayOfWeek === 6;
        if (preset === 'even') return { ...setting, isRestDay: false, weight: 1 };
        if (preset === 'weekday') {
          return { ...setting, isRestDay: false, weight: isWeekend ? 0.5 : 1.5 };
        }
        return { ...setting, isRestDay: false, weight: isWeekend ? 2 : 0.7 };
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['even', '毎日おなじ'],
            ['weekday', '平日を多め'],
            ['weekend', '休日を多め'],
          ] as const
        ).map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {value.map((setting) => (
          <li key={setting.dayOfWeek} className="flex items-center gap-3 px-3 py-2.5">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                setting.dayOfWeek === 0
                  ? 'bg-rose-50 text-rose-600'
                  : setting.dayOfWeek === 6
                    ? 'bg-sky-50 text-sky-600'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {WEEKDAY_LABELS[setting.dayOfWeek]}
            </span>

            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={setting.isRestDay}
                onChange={(event) => patch(setting.dayOfWeek, { isRestDay: event.target.checked })}
                className="size-4 accent-indigo-600"
              />
              休養日
            </label>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-400">量の比率</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={setting.weight}
                disabled={setting.isRestDay}
                onChange={(event) =>
                  patch(setting.dayOfWeek, { weight: Math.max(0, Number(event.target.value) || 0) })
                }
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        比率は相対値です。平日 1.5 / 土日 0.5 なら、平日は土日の3倍の量が割り当てられます。
      </p>
    </div>
  );
}
