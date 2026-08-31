import { useEffect, useState } from 'react';
import type { SyncApi } from '../hooks/useSync';
import { createSyncCode } from '../lib/syncClient';
import { SyncError } from '../lib/syncClient';

const STATUS_LABEL = {
  idle: '同期しています',
  syncing: '同期中…',
  error: '同期できていません',
  offline: 'オフラインです',
} as const;

const STATUS_STYLE = {
  idle: 'bg-emerald-100 text-emerald-700',
  syncing: 'bg-indigo-100 text-indigo-700',
  error: 'bg-rose-100 text-rose-700',
  offline: 'bg-slate-200 text-slate-600',
} as const;

function formatSyncedAt(value: string | null): string {
  if (value === null) return 'まだ同期していません';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'まだ同期していません';
  return `最終同期 ${date.toLocaleString('ja-JP')}`;
}

export default function SyncSection({ sync }: { sync: SyncApi }) {
  const [code, setCode] = useState(sync.settings.code);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => setCode(sync.settings.code), [sync.settings.code]);

  const trimmedCode = code.trim();

  const handleConnect = () => {
    if (trimmedCode === '') {
      setNotice({ tone: 'error', text: '同期コードを入力してください。' });
      return;
    }
    sync.updateSettings({ code: trimmedCode, lastSyncedAt: null });
    setNotice({ tone: 'ok', text: '設定を保存しました。まもなく同期されます。' });
  };

  const handleCreate = async () => {
    if (
      sync.isConfigured &&
      !window.confirm(
        '新しい同期コードを発行すると、今つながっている端末とは別のデータになります。よろしいですか?',
      )
    ) {
      return;
    }
    setIsCreating(true);
    setNotice(null);
    try {
      const issued = await createSyncCode();
      setCode(issued);
      sync.updateSettings({ code: issued, lastSyncedAt: null });
      setNotice({
        tone: 'ok',
        text: 'コードを発行しました。他の端末でもこのコードを入力してください。',
      });
    } catch (cause) {
      setNotice({
        tone: 'error',
        text:
          cause instanceof SyncError
            ? cause.message
            : 'サーバーに接続できませんでした。通信環境を確認してください。',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDisconnect = () => {
    if (!window.confirm('同期を解除します。この端末のデータはそのまま残ります。よろしいですか?')) {
      return;
    }
    sync.updateSettings({ code: '', lastSyncedAt: null });
    setCode('');
    setNotice({ tone: 'ok', text: '同期を解除しました。' });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sync.settings.code);
      setNotice({ tone: 'ok', text: '同期コードをコピーしました。' });
    } catch {
      setNotice({ tone: 'error', text: 'コピーできませんでした。手で選択してください。' });
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-700">端末間で同期</h3>
          {sync.isConfigured && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[sync.status]}`}
            >
              {STATUS_LABEL[sync.status]}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          同期コードを共有した端末どうしで、プランと記録を1つにまとめます。
          オフラインでもこれまで通り使えて、つながったときに自動で反映されます。
        </p>
        <p className="mt-1 text-xs text-slate-400">
          はじめて使うときは <strong className="font-semibold text-slate-500">新しいコードを発行</strong>{' '}
          を押してください。すでに他の端末で使っている場合は、そのコードを入力します。
        </p>
      </div>

      {notice && (
        <p
          className={`rounded-xl border px-3 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </p>
      )}

      {sync.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {sync.error}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-slate-700">同期コード</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABCD-EFGH-JKLM-NPQR-STVW-XYZ2-34"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm tracking-wide focus:border-indigo-500 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleConnect}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          このコードで同期する
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isCreating}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {isCreating ? '発行中…' : '新しいコードを発行'}
        </button>
        {sync.isConfigured && (
          <>
            <button
              type="button"
              onClick={() => void sync.sync()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              今すぐ同期
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              コードをコピー
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              同期を解除
            </button>
          </>
        )}
      </div>

      {sync.isConfigured && (
        <p className="text-xs text-slate-500">{formatSyncedAt(sync.settings.lastSyncedAt)}</p>
      )}

      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
        同期コードはパスワードと同じです。これを知っている人は誰でもデータを読み書きできます。
        人に見えるところに貼らないでください。
      </p>
    </section>
  );
}
