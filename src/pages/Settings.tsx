import { useRef, useState } from 'react';
import type { AppDataApi } from '../hooks/usePlans';
import type { SyncApi } from '../hooks/useSync';
import { emptyData, exportToJson, importFromJson } from '../storage';
import SyncSection from '../components/SyncSection';

export default function Settings({ api, sync }: { api: AppDataApi; sync: SyncApi }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const handleExport = () => {
    const blob = new Blob([exportToJson(api.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `studyschedule-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // ダウンロードが始まる前に失効させないよう、少し待ってから解放する。
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage({ tone: 'ok', text: 'データを書き出しました。' });
  };

  const handleImport = async (file: File) => {
    try {
      const result = importFromJson(await file.text());
      const dropped =
        result.droppedPlanCount > 0
          ? `(${result.droppedPlanCount}件は形式が合わず読み込めませんでした)`
          : '';
      if (
        !window.confirm(
          `プラン ${result.data.plans.length}件を読み込みます${dropped}。今のデータは置き換えられます。よろしいですか?`,
        )
      ) {
        return;
      }
      api.replaceAll(result.data);
      setMessage({
        tone: result.droppedPlanCount > 0 ? 'error' : 'ok',
        text: `プラン ${result.data.plans.length}件を読み込みました。${dropped}`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'ファイルを読み込めませんでした。',
      });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleReset = () => {
    if (!window.confirm('すべてのプランと記録を削除します。元に戻せません。よろしいですか?')) return;
    // 同期している場合に他の端末から復活しないよう、削除したことを記録に残す。
    const deletedAt = new Date().toISOString();
    api.replaceAll({
      ...emptyData(),
      deletions: api.data.plans.map((plan) => ({ planId: plan.id, deletedAt })),
    });
    setMessage({ tone: 'ok', text: 'すべてのデータを削除しました。' });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-slate-900">設定</h2>

      {message && (
        <div
          className={`rounded-xl border px-3 py-2.5 text-sm ${
            message.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <SyncSection sync={sync} />

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">データの持ち出し・読み込み</h3>
          <p className="mt-1 text-xs text-slate-500">
            データはこのブラウザの中だけに保存されます。別の端末やブラウザに移すときは、書き出した
            JSON ファイルを読み込んでください。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            JSONで書き出す
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            JSONを読み込む
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">現在のデータ</h3>
        <p className="text-sm text-slate-600">
          プラン {api.data.plans.length}件 / タスク {api.data.tasks.length}件
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-rose-700">すべて削除</h3>
          <p className="mt-1 text-xs text-slate-500">
            プランと学習記録をすべて消します。元に戻せません。
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
        >
          データをすべて削除
        </button>
      </section>
    </div>
  );
}
