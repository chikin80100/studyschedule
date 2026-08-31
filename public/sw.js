/* eslint-env serviceworker */
/**
 * StudySchedule の Service Worker。
 *
 * 役割は「勉強開始のお知らせ」を受け取って通知を出すことだけで、
 * ページやデータのキャッシュはしない。キャッシュを持つと、更新したのに
 * 古い画面が出続ける事故が起きやすいわりに、得られるものが少ないため。
 *
 * サーバーから届くプッシュは中身が空 (ペイロードなし) で送られてくる。
 * 中身を暗号化して運ぶ仕組みは複雑なわりに、ここで欲しいのは
 * 「今日やること」の短い文だけなので、その文はアプリ側が Cache API に
 * 書いておき、この Worker が読み出して通知本文にする。
 *
 * 置かれているのは「日付 → 文面」の対応表で、数週間先ぶんが入っている。
 * 通知を出す時点でアプリが開かれているとは限らないため、今日ぶんだけ
 * 置いておくと、しばらく開かずにいた場合に古い日の残量を出してしまう。
 */

const REMINDER_CACHE = 'studyschedule-reminder';
const REMINDER_KEY = 'reminder-text';

const DEFAULT_TITLE = '勉強の時間です';
const DEFAULT_BODY = '今日のタスクを確認しましょう。';

/** 端末の暦での今日を 'YYYY-MM-DD' で返す。 */
function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

self.addEventListener('install', () => {
  // 新しい Service Worker をすぐ有効にする。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 開いているタブをすぐこの Worker の管理下に置く。
  event.waitUntil(self.clients.claim());
});

/**
 * アプリが書き込んだ対応表から「今日やること」を読む。
 * 表が無い / 今日ぶんが入っていない (長く開いていない) 場合は既定の文言にする。
 * 古い日の残量をそのまま出すと、事実と違う数を知らせてしまうため。
 */
async function readReminderText() {
  try {
    const cache = await caches.open(REMINDER_CACHE);
    const stored = await cache.match(REMINDER_KEY);
    if (!stored) return { title: DEFAULT_TITLE, body: DEFAULT_BODY };

    const schedule = await stored.json();
    const value = schedule?.[localToday()];
    return {
      title: typeof value?.title === 'string' && value.title !== '' ? value.title : DEFAULT_TITLE,
      body: typeof value?.body === 'string' && value.body !== '' ? value.body : DEFAULT_BODY,
    };
  } catch {
    return { title: DEFAULT_TITLE, body: DEFAULT_BODY };
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      // 念のためペイロード付きでも動くようにしておく。
      let payload = null;
      if (event.data) {
        try {
          payload = event.data.json();
        } catch {
          payload = null;
        }
      }

      const fallback = await readReminderText();
      const title = payload?.title ?? fallback.title;
      const body = payload?.body ?? fallback.body;

      await self.registration.showNotification(title, {
        body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        lang: 'ja',
        tag: 'studyschedule-reminder',
        renotify: true,
        requireInteraction: false,
        data: { url: './' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? './', self.location.href).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // すでに開いていればそれを前面に出す。無ければ新しく開く。
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
