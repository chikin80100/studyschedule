import { useState } from 'react';
import type { ReminderApi } from '../hooks/useReminder';
import { WEEKDAY_LABELS, DAYS_OF_WEEK } from '../types';

const PRESETS = [
  { label: '毎日', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: '平日', days: [1, 2, 3, 4, 5] },
  { label: '土日', days: [0, 6] },
] as const;

export default function ReminderSection({ reminder }: { reminder: ReminderApi }) {
  const [notice, setNotice] = useState<string | null>(null);
  const { settings, state, busy } = reminder;

  const toggleWeekday = (day: number) => {
    const next = settings.weekdays.includes(day)
      ? settings.weekdays.filter((value) => value !== day)
      : [...settings.weekdays, day].sort((a, b) => a - b);
    // 全部外すと通知が来なくなり分かりにくいので、最低1日は残す。
    if (next.length === 0) return;
    void reminder.update({ weekdays: next });
  };

  const handleEnable = async () => {
    setNotice(null);
    await reminder.enable(settings);
  };

  const handleTest = async () => {
    setNotice(null);
    await reminder.sendTest();
    setNotice('テスト通知を送りました。数秒待っても届かない場合は、端末の通知設定を確認してください。');
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">勉強開始のお知らせ</h3>
          {state.kind === 'on' && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              オン
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          決めた時刻に「今日やること」を通知します。アプリを閉じていても届きます。
        </p>
      </div>

      {state.kind === 'unsupported' && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          {state.reason}
        </p>
      )}

      {state.kind === 'needs-sync' && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          通知はサーバーから送るため、先に上の「端末間で同期」で同期コードを用意してください。
        </p>
      )}

      {state.kind === 'denied' && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          通知が拒否されています。ブラウザ (またはスマホ) の設定でこのサイトの通知を許可してから、
          もう一度お試しください。
        </p>
      )}

      {!reminder.standalone && state.kind !== 'unsupported' && (
        <p className="rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900">
          iPhone・iPad では、共有メニューから <strong>ホーム画面に追加</strong> して、
          そこから開いた場合のみ通知を使えます。
        </p>
      )}

      {reminder.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {reminder.error}
        </p>
      )}

      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-slate-700">通知する時刻</span>
        <input
          type="time"
          value={settings.time}
          onChange={(event) => void reminder.update({ time: event.target.value })}
          disabled={state.kind === 'unsupported' || state.kind === 'needs-sync'}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
        />
      </label>

      <div>
        <span className="text-sm font-medium text-slate-700">通知する曜日</span>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {DAYS_OF_WEEK.map((day) => {
            const on = settings.weekdays.includes(day);
            return (
              <li key={day}>
                <button
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  disabled={state.kind === 'unsupported' || state.kind === 'needs-sync'}
                  aria-pressed={on}
                  aria-label={`${WEEKDAY_LABELS[day]}曜日`}
                  className={`flex size-10 items-center justify-center rounded-full text-sm font-bold transition disabled:opacity-50 ${
                    on
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-300 bg-white text-slate-500 hover:border-indigo-300'
                  }`}
                >
                  {WEEKDAY_LABELS[day]}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => void reminder.update({ weekdays: [...preset.days] })}
              disabled={state.kind === 'unsupported' || state.kind === 'needs-sync'}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {state.kind === 'on' ? (
          <>
            <button
              type="button"
              onClick={() => void reminder.disable()}
              disabled={busy}
              className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
            >
              通知をオフにする
            </button>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={busy}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? '送信中…' : 'テスト通知を送る'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleEnable()}
            disabled={busy || state.kind === 'unsupported' || state.kind === 'needs-sync'}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? '設定中…' : '通知をオンにする'}
          </button>
        )}
      </div>
    </section>
  );
}
