import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import type { SyncSettings } from '../lib/sync';
import { isSyncConfigured } from '../lib/sync';
import {
  buildReminderText,
  checkPushSupport,
  currentTimeZone,
  decodeVapidKey,
  isStandalone,
  registerServiceWorker,
  storeReminderText,
} from '../lib/notify';
import { today as todayString } from '../lib/date';

/** 通知の設定。端末ごとに保存する (サーバーにも同じ内容を預ける)。 */
export type ReminderSettings = {
  enabled: boolean;
  /** 'HH:MM' */
  time: string;
  /** 0=日 ... 6=土 */
  weekdays: number[];
};

export type ReminderState =
  | { kind: 'unsupported'; reason: string }
  /** 同期の設定が先に必要 (通知はサーバーから送るため) */
  | { kind: 'needs-sync' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on' };

const STORAGE_KEY = 'studyschedule.reminder';

function defaultSettings(): ReminderSettings {
  return { enabled: false, time: '19:00', weekdays: [0, 1, 2, 3, 4, 5, 6] };
}

function loadSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const value = JSON.parse(raw) as Partial<ReminderSettings>;
    const weekdays = Array.isArray(value.weekdays)
      ? value.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [];
    return {
      enabled: value.enabled === true,
      time: typeof value.time === 'string' && /^\d{2}:\d{2}$/.test(value.time) ? value.time : '19:00',
      weekdays: weekdays.length > 0 ? [...new Set(weekdays)].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6],
    };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings: ReminderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 保存できなくても動作に影響はない */
  }
}

/**
 * 購読に失敗した理由を日本語にする。
 * ブラウザが返すのは英語の短い文なので、そのまま出すと分かりにくい。
 */
export function subscribeErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  if (/permission/i.test(raw)) {
    return '通知が許可されませんでした。ブラウザ (スマホの場合は端末) の設定で、このサイトの通知を許可してください。';
  }
  // 鍵の食い違いも "Registration failed - ..." で来るので、先に見分ける。
  if (/applicationServerKey|gcm_sender_id|InvalidAccessError|InvalidStateError/i.test(raw)) {
    return '通知の設定が前回と食い違っています。一度「通知をオフにする」を押してから、もう一度オンにしてください。';
  }
  if (/AbortError|push service|registration failed/i.test(raw)) {
    return 'ブラウザの通知サービスに接続できませんでした。ネットワークにつながっているか確認して、もう一度お試しください。';
  }
  return '通知の登録に失敗しました。時間をおいて、もう一度お試しください。';
}

export type ReminderApi = {
  settings: ReminderSettings;
  state: ReminderState;
  busy: boolean;
  error: string | null;
  /** ホーム画面に追加済みか (iOS で通知を使うのに必要) */
  standalone: boolean;
  /** 通知をオンにする。許可を求めて購読を登録する。 */
  enable: (settings: ReminderSettings) => Promise<void>;
  /** 時刻や曜日だけ変える (オンのときはサーバーにも反映)。 */
  update: (changes: Partial<ReminderSettings>) => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
};

/**
 * 「勉強開始のお知らせ」を扱う。
 *
 * 通知はサーバー (Worker) から Web Push で送るので、
 *   1. Service Worker を登録し
 *   2. 通知の許可をもらい
 *   3. 購読 (この端末の宛先) を作ってサーバーに預ける
 * という順に進む。サーバーは同期コードで利用者を見分けるため、
 * 先に同期の設定が済んでいる必要がある。
 */
export function useReminder(sync: SyncSettings, data: AppData): ReminderApi {
  const [settings, setSettings] = useState<ReminderSettings>(loadSettings);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);

  const syncRef = useRef(sync);
  syncRef.current = sync;

  const support = checkPushSupport();

  useEffect(() => {
    setStandalone(isStandalone());
    void registerServiceWorker();
  }, []);

  // 通知の文面は「今日の残り」なので、データが変わるたびに置き直す。
  useEffect(() => {
    void storeReminderText(buildReminderText(data.plans, data.tasks, todayString()));
  }, [data]);

  const state: ReminderState = !support.supported
    ? { kind: 'unsupported', reason: support.reason }
    : !isSyncConfigured(sync)
      ? { kind: 'needs-sync' }
      : permission === 'denied'
        ? { kind: 'denied' }
        : settings.enabled
          ? { kind: 'on' }
          : { kind: 'off' };

  /** サーバーに購読と時刻を預ける。 */
  const registerOnServer = useCallback(
    async (next: ReminderSettings, subscription: PushSubscription) => {
      const current = syncRef.current;
      const response = await fetch(`${current.apiBase}/api/push`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${current.code}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          time: next.time,
          timeZone: currentTimeZone(),
          weekdays: next.weekdays,
          enabled: next.enabled,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'サーバーに通知の設定を保存できませんでした。');
      }
    },
    [],
  );

  /** この端末のプッシュ購読を用意する。無ければ作る。 */
  const ensureSubscription = useCallback(async (): Promise<PushSubscription> => {
    const registration = await registerServiceWorker();
    if (registration === null) throw new Error('このブラウザは通知に対応していません。');
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    if (existing !== null) return existing;

    const current = syncRef.current;
    const keyResponse = await fetch(`${current.apiBase}/api/push/key`);
    if (!keyResponse.ok) throw new Error('サーバーから通知用の鍵を取得できませんでした。');
    const { publicKey } = (await keyResponse.json()) as { publicKey: string };

    try {
      return await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(publicKey) as BufferSource,
      });
    } catch (cause) {
      // ブラウザからの理由は英語なので、日本語にして返す。
      throw new Error(subscribeErrorMessage(cause));
    }
  }, []);

  const enable = useCallback(
    async (next: ReminderSettings) => {
      setBusy(true);
      setError(null);
      try {
        const granted = await Notification.requestPermission();
        setPermission(granted);
        if (granted !== 'granted') {
          throw new Error(
            granted === 'denied'
              ? '通知が拒否されています。ブラウザの設定から許可してください。'
              : '通知が許可されませんでした。',
          );
        }

        const subscription = await ensureSubscription();
        const enabled = { ...next, enabled: true };
        await registerOnServer(enabled, subscription);
        setSettings(enabled);
        saveSettings(enabled);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '通知を設定できませんでした。');
      } finally {
        setBusy(false);
      }
    },
    [ensureSubscription, registerOnServer],
  );

  const update = useCallback(
    async (changes: Partial<ReminderSettings>) => {
      const next = { ...settings, ...changes };
      setSettings(next);
      saveSettings(next);
      if (!next.enabled) return;

      setBusy(true);
      setError(null);
      try {
        const subscription = await ensureSubscription();
        await registerOnServer(next, subscription);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '通知の設定を変更できませんでした。');
      } finally {
        setBusy(false);
      }
    },
    [settings, ensureSubscription, registerOnServer],
  );

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    const next = { ...settings, enabled: false };
    setSettings(next);
    saveSettings(next);
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const current = syncRef.current;
        await fetch(`${current.apiBase}/api/push`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${current.code}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通知を解除できませんでした。');
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const subscription = await ensureSubscription();
      const current = syncRef.current;
      const response = await fetch(`${current.apiBase}/api/push/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${current.code}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'テスト通知を送れませんでした。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'テスト通知を送れませんでした。');
    } finally {
      setBusy(false);
    }
  }, [ensureSubscription]);

  return { settings, state, busy, error, standalone, enable, update, disable, sendTest };
}
