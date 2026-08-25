import { useEffect, useState } from 'react';
import type { DayOfWeek, WeekdaySetting } from '../types';
import { WEEKDAY_LABELS } from '../types';

type Props = {
  value: WeekdaySetting[];
  onChange: (next: WeekdaySetting[]) => void;
};

/** 曜日ごとに休養日か、学習する場合の相対量(比率)かを設定する。 */
export default function WeekdayWeightEditor({ value, onChange }: Props) {
  const patch = (dayOfWeek: DayOfWeek, changes: Partial<WeekdaySetting>) => {
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
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {value.map((setting) => (
          <WeekdayRow key={setting.dayOfWeek} setting={setting} onPatch={patch} />
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        比率は相対値です。平日 1.5 / 土日 0.5 なら、平日は土日の3倍の量が割り当てられます。
        0 にするとその曜日は休養日と同じ扱いになります。
      </p>
    </div>
  );
}

type RowProps = {
  setting: WeekdaySetting;
  onPatch: (dayOfWeek: DayOfWeek, changes: Partial<WeekdaySetting>) => void;
};

function WeekdayRow({ setting, onPatch }: RowProps) {
  // 「1.5」と打つ途中の "1." は数値にできないため、入力中は文字列のまま持つ。
  const [draft, setDraft] = useState(`${setting.weight}`);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(`${setting.weight}`);
  }, [setting.weight, isEditing]);

  const commit = () => {
    setIsEditing(false);
    const parsed = Number(draft);
    const weight = Number.isFinite(parsed) && parsed >= 0 ? parsed : setting.weight;
    setDraft(`${weight}`);
    onPatch(setting.dayOfWeek, { weight });
  };

  const label = WEEKDAY_LABELS[setting.dayOfWeek];

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          setting.dayOfWeek === 0
            ? 'bg-rose-50 text-rose-600'
            : setting.dayOfWeek === 6
              ? 'bg-sky-50 text-sky-600'
              : 'bg-slate-100 text-slate-600'
        }`}
      >
        {label}
      </span>

      <label className="flex items-center gap-1.5 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={setting.isRestDay}
          onChange={(event) => onPatch(setting.dayOfWeek, { isRestDay: event.target.checked })}
          className="size-5 accent-indigo-600"
        />
        休養日
      </label>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-slate-400">量の比率</span>
        <input
          type="number"
          min={0}
          step={0.1}
          inputMode="decimal"
          aria-label={`${label}曜日の量の比率`}
          value={draft}
          disabled={setting.isRestDay}
          onFocus={() => setIsEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="h-10 w-20 rounded-lg border border-slate-300 px-2 text-right text-sm disabled:bg-slate-100 disabled:text-slate-400"
        />
      </div>
    </li>
  );
}
