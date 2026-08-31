import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import type { SyncSettings } from '../lib/sync';
import { isSameAppData, isSyncConfigured, loadSyncSettings, saveSyncSettings } from '../lib/sync';
import { SyncError, syncNow } from '../lib/syncClient';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/** 変更してからサーバーへ送るまでの待ち時間。連打しても1回にまとめる。 */
const DEBOUNCE_MS = 3000;

export type SyncApi = {
  settings: SyncSettings;
  status: SyncStatus;
  /** 直近の失敗理由。成功したら null に戻る。 */
  error: string | null;
  isConfigured: boolean;
  /** 設定を変える。同期コードを変えたら次の同期で新しい領域とつながる。 */
  updateSettings: (changes: Partial<SyncSettings>) => void;
  /** 今すぐ同期する。手動ボタンから呼ぶ。 */
  sync: () => Promise<void>;
};

/**
 * ローカルのデータをサーバーと同期し続ける。
 *
 * 書き込みはこれまで通り localStorage に対して行い、この仕組みは後追いで
 * サーバーと突き合わせるだけ。オフラインでもアプリは普通に使える。
 *
 * 同期のきっかけは3つ:
 *   - 起動時 (他の端末での変更を取り込む)
 *   - データが変わってから少し経ったとき
 *   - オンラインに戻ったとき / タブが再表示されたとき
 *
 * 注意: run は依存を持たないコールバックにしてある。ここに毎レンダー変わる値を
 * 混ぜると、起動時の副作用が張り直されるたびに同期が走り、止まらなくなる。
 * 最新の値はすべて ref 経由で読む。
 */
export function useSync(
  data: AppData,
  isLoaded: boolean,
  applyMerged: (merged: AppData) => void,
): SyncApi {
  const [settings, setSettings] = useState<SyncSettings>(loadSyncSettings);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // 同期の実行中に最新の値を参照するための箱。副作用の依存を増やさないために使う。
  const dataRef = useRef(data);
  const settingsRef = useRef(settings);
  const applyMergedRef = useRef(applyMerged);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  dataRef.current = data;
  settingsRef.current = settings;
  applyMergedRef.current = applyMerged;

  const isConfigured = isSyncConfigured(settings);
  // 接続先が変わったら (コードを入れ直した / 発行し直した) すぐ同期し直す。
  const syncTarget = settings.code;

  const writeSettings = useCallback((changes: Partial<SyncSettings>) => {
    const next = { ...settingsRef.current, ...changes };
    settingsRef.current = next;
    saveSyncSettings(next);
    setSettings(next);
  }, []);

  const updateSettings = useCallback(
    (changes: Partial<SyncSettings>) => {
      writeSettings(changes);
      setError(null);
    },
    [writeSettings],
  );

  const run = useCallback(async () => {
    const current = settingsRef.current;
    if (!isSyncConfigured(current)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }
    // 実行中に来た要求は、終わってから1回だけまとめて処理する。
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }

    runningRef.current = true;
    setStatus('syncing');
    try {
      const result = await syncNow(current, dataRef.current);
      // 中身が変わっていないのに保存すると、その変更がまた同期を呼んで止まらなくなる。
      // キーの並びの違いで誤判定しないよう、内容で比べる。
      if (!isSameAppData(result.data, dataRef.current)) {
        applyMergedRef.current(result.data);
      }
      writeSettings({ lastSyncedAt: result.syncedAt });
      setStatus('idle');
      setError(null);
    } catch (cause) {
      setStatus('error');
      setError(
        cause instanceof SyncError
          ? cause.message
          : 'サーバーに接続できませんでした。通信環境を確認してください。',
      );
    } finally {
      runningRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void run();
      }
    }
  }, [writeSettings]);

  // 起動時、接続先を変えたとき、オンライン復帰・タブ復帰のたびに同期する。
  useEffect(() => {
    if (!isLoaded || !isConfigured) return;
    void run();

    const onWake = () => {
      if (document.visibilityState === 'visible') void run();
    };
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [isLoaded, isConfigured, syncTarget, run]);

  // データが変わったら、少し待ってからまとめて送る。
  useEffect(() => {
    if (!isLoaded || !isConfigured) return;
    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [data, isLoaded, isConfigured, run]);

  return { settings, status, error, isConfigured, updateSettings, sync: run };
}
