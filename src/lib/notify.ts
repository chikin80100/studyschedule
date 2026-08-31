import type { Plan, Task } from '../types';
import { computeDayCompletion } from './progress';
import { formatAmount } from './format';

/**
 * 「勉強開始のお知らせ」まわりの下ごしらえ。
 *
 * 通知そのものは Service Worker が出すが、その文面はこちらで作って
 * Cache API に置いておく。サーバーから届くプッシュは中身が空なので、
 * Service Worker はここに書かれた文を読んで通知にする。
 */

const REMINDER_CACHE = 'studyschedule-reminder';
const REMINDER_KEY = 'reminder-text';

export type ReminderText = { title: string; body: string };

/** その日の予定から通知の文面を作る。 */
export function buildReminderText(plans: Plan[], tasks: Task[], date: string): ReminderText {
  const completion = computeDayCompletion(tasks, date);
  if (completion.total === 0) {
    return { title: '勉強の時間です', body: '今日は予定がありません。休むのも計画のうちです。' };
  }
  if (completion.completed >= completion.total) {
    return { title: 'お疲れさまでした', body: '今日の分はすべて終わっています。' };
  }

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const remaining = tasks
    .filter(
      (task) =>
        task.date === date &&
        task.kind === 'study' &&
        task.plannedAmount > 0 &&
        !task.isCompleted &&
        task.doneAmount < task.plannedAmount,
    )
    .map((task) => {
      const plan = planById.get(task.planId);
      if (plan === undefined) return null;
      return `${plan.title} ${formatAmount(task.plannedAmount - task.doneAmount, plan.unit)}`;
    })
    .filter((line): line is string => line !== null);

  return {
    title: '勉強の時間です',
    // 多すぎると通知に収まらないので、先頭の3件だけ出す。
    body: remaining.slice(0, 3).join(' / ') + (remaining.length > 3 ? ' ほか' : ''),
  };
}

/**
 * 通知の文面を Service Worker から読める場所に置く。
 * localStorage は Service Worker から読めないため Cache API を使う。
 */
export async function storeReminderText(text: ReminderText): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(REMINDER_CACHE);
    await cache.put(
      REMINDER_KEY,
      new Response(JSON.stringify(text), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  } catch {
    // 置けなくても既定の文面で通知は出るので、失敗しても進める。
  }
}

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

/** この環境でプッシュ通知が使えるか。使えない理由も返す。 */
export function checkPushSupport(): PushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'この環境では使えません。' };
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'このブラウザは通知に対応していません。' };
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    return {
      supported: false,
      reason:
        'このブラウザは通知に対応していません。iPhone の場合は、共有メニューから「ホーム画面に追加」してから開いてください。',
    };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: '通知は https のページでのみ使えます。' };
  }
  return { supported: true };
}

/** iOS はホーム画面に追加した状態でないと通知を使えない。 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** Service Worker を登録する。対応していなければ null。 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    // import.meta.env.BASE_URL は '/studyschedule/' のような公開パス。
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  } catch (error) {
    console.error('Service Worker を登録できませんでした', error);
    return null;
  }
}

/** サーバーの公開鍵 (base64url) を、購読に渡せる形に変換する。 */
export function decodeVapidKey(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** この端末のタイムゾーン。取れなければ UTC。 */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
