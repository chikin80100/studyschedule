/**
 * StudySchedule の同期サーバー (Cloudflare Workers + D1)。
 *
 * やることは1つだけ: 同期コードごとに JSON をひとつ預かり、読み書きさせる。
 * データの中身の解釈やマージはクライアント側で完結させ、ここでは触らない。
 *
 * 認証は「同期コードを知っていること」だけ。コードは Authorization ヘッダーで送り、
 * サーバーには SHA-256 のハッシュだけを保存する。
 *
 * もうひとつ「勉強開始のお知らせ」を預かる。指定時刻に Web Push を送るため、
 * 定時実行 (cron) で毎分「いま送るべき購読」を探して送信する。
 *
 * エンドポイント:
 *   POST   /api/space          新しい同期コードを発行する
 *   GET    /api/space          今のデータを取得する      (Authorization: Bearer <code>)
 *   PUT    /api/space          データを保存する          (Authorization + If-Match: <revision>)
 *   GET    /api/push/key       通知の購読に必要な公開鍵を返す
 *   PUT    /api/push           お知らせの購読を登録・更新する (Authorization)
 *   DELETE /api/push           購読を解除する                 (Authorization)
 *   POST   /api/push/test      いますぐテスト送信する         (Authorization)
 *   GET    /api/health         疎通確認
 */

import {
  checkDue,
  normalizeWeekdays,
  parseTime,
  type Reminder,
} from './reminders';
import { generateVapidKeys, sendPush, type VapidKeys } from './webpush';

export type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  /** VAPID の連絡先。通知先のサービスが問題を見つけたときの宛先になる。 */
  VAPID_SUBJECT?: string;
};

/** 保存できる JSON の上限。D1 の行サイズと悪用の両方を抑える。 */
const MAX_BODY_BYTES = 1_000_000;
/** 同期コードの長さ (Base32 相当の文字数)。約 130 ビットの乱数。 */
const CODE_LENGTH = 26;
/** 紛らわしい文字 (0/O, 1/I/L) を除いた英数字。口頭や手入力でも間違えにくい。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** VAPID の連絡先。設定が無ければ実在しないが形式として妥当な値を使う。 */
const DEFAULT_VAPID_SUBJECT = 'mailto:studyschedule@example.invalid';

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  // 未設定なら制限しない (ローカル開発用)。設定してあれば一致したものだけ返す。
  const allowOrigin =
    allowed.length === 0 ? origin || '*' : allowed.includes(origin) ? origin : '';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin !== '') headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(message: string, status: number, headers: Record<string, string>): Response {
  return json({ error: message }, status, headers);
}

/** 同期コードを作る。推測されないよう暗号用の乱数から作る。 */
function createSyncCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  // 4文字ごとに区切って読みやすくする (照合時にハイフンは無視する)。
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/** 表記ゆれ (小文字・ハイフン・空白) を吸収してから比較・保存する。 */
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`studyschedule:${normalizeCode(code)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCode(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const code = normalizeCode(match[1]);
  return code.length === CODE_LENGTH ? code : null;
}

type SpaceRow = { revision: string; data: string; updated_at: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (headers['Access-Control-Allow-Origin'] === undefined && request.headers.has('Origin')) {
      return fail('このオリジンからのアクセスは許可されていません。', 403, headers);
    }

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true }, 200, headers);
      }
      if (url.pathname === '/api/push/key') {
        if (request.method !== 'GET') return fail('このメソッドは使えません。', 405, headers);
        return json({ publicKey: (await loadVapidKeys(env)).publicKey }, 200, headers);
      }
      if (url.pathname === '/api/push/test') {
        if (request.method !== 'POST') return fail('このメソッドは使えません。', 405, headers);
        return await sendTestPush(request, env, headers);
      }
      if (url.pathname === '/api/push') {
        if (request.method === 'PUT') return await saveReminder(request, env, headers);
        if (request.method === 'DELETE') return await deleteReminder(request, env, headers);
        if (request.method === 'GET') return await readReminder(request, env, headers);
        return fail('このメソッドは使えません。', 405, headers);
      }
      if (url.pathname === '/api/space') {
        if (request.method === 'POST') return await createSpace(env, headers);
        if (request.method === 'GET') return await readSpace(request, env, headers);
        if (request.method === 'PUT') return await writeSpace(request, env, headers);
        return fail('このメソッドは使えません。', 405, headers);
      }
      return fail('見つかりません。', 404, headers);
    } catch (error) {
      console.error(error);
      return fail('サーバー側でエラーが発生しました。', 500, headers);
    }
  },

  /**
   * 毎分動く定時実行。指定時刻を迎えた購読にプッシュを送る。
   * 実行が数分ずれても取りこぼさないよう、checkDue 側で猶予を持たせている。
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(deliverDueReminders(env));
  },
} satisfies ExportedHandler<Env>;

/** 新しい同期コードを発行し、空のデータで領域を作る。 */
async function createSpace(env: Env, headers: Record<string, string>): Promise<Response> {
  const code = createSyncCode();
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const empty = JSON.stringify({ version: 2, plans: [], tasks: [], deletions: [] });

  await env.DB.prepare(
    `INSERT INTO spaces (code_hash, revision, data, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(await hashCode(code), revision, empty, now, now)
    .run();

  // コードを返すのはこの一度きり。サーバーには復元できる形で残らない。
  return json({ code, revision }, 201, headers);
}

async function readSpace(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  const row = await env.DB.prepare(
    'SELECT revision, data, updated_at FROM spaces WHERE code_hash = ?',
  )
    .bind(await hashCode(code))
    .first<SpaceRow>();

  if (row === null) return fail('この同期コードは見つかりませんでした。', 404, headers);

  return json({ revision: row.revision, updatedAt: row.updated_at, data: JSON.parse(row.data) }, 200, {
    ...headers,
    ETag: row.revision,
  });
}

/**
 * データを保存する。If-Match に「読み込んだときの revision」を入れてもらい、
 * その間に他の端末が保存していたら 409 を返す。
 * クライアントは取得しなおしてマージし、もう一度送る。
 */
async function writeSpace(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return fail('データが大きすぎます。', 413, headers);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail('JSON として読めません。', 400, headers);
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { plans?: unknown }).plans)) {
    return fail('StudySchedule のデータではありません。', 400, headers);
  }

  const codeHash = await hashCode(code);
  const current = await env.DB.prepare('SELECT revision, data, updated_at FROM spaces WHERE code_hash = ?')
    .bind(codeHash)
    .first<SpaceRow>();
  if (current === null) return fail('この同期コードは見つかりませんでした。', 404, headers);

  const expected = request.headers.get('If-Match');
  if (expected !== null && expected !== current.revision) {
    // 別の端末が先に保存している。取得しなおしてマージするための情報を返す。
    return json(
      {
        error: '別の端末が先に更新しました。',
        revision: current.revision,
        updatedAt: current.updated_at,
        data: JSON.parse(current.data),
      },
      409,
      { ...headers, ETag: current.revision },
    );
  }

  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  await env.DB.prepare('UPDATE spaces SET revision = ?, data = ?, updated_at = ? WHERE code_hash = ?')
    .bind(revision, body, now, codeHash)
    .run();

  return json({ revision, updatedAt: now }, 200, { ...headers, ETag: revision });
}

// ─────────────────────────────────────────────────────────────
// 勉強開始のお知らせ (Web Push)
// ─────────────────────────────────────────────────────────────

type ReminderRow = {
  endpoint: string;
  time: string;
  time_zone: string;
  weekdays: string;
  enabled: number;
  last_sent_on: string | null;
};

/**
 * VAPID の鍵を取り出す。無ければ作って保存する。
 *
 * 鍵を設定ファイルや環境変数で渡す形にすると、利用者が自分で鍵を生成して
 * secret に登録する手順が増える。個人で使うサーバーなので、初回アクセス時に
 * サーバー自身が作って D1 に保存する形にした。
 * (DB が漏れると他人の端末に通知を送れてしまうが、送れるのは通知だけで、
 *  学習データを読むには同期コードが別途必要。)
 */
async function loadVapidKeys(env: Env): Promise<VapidKeys> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('vapid')
    .first<{ value: string }>();
  if (row !== null) return JSON.parse(row.value) as VapidKeys;

  const keys = await generateVapidKeys();
  // 同時に2つ作られても、先に入ったほうを使う。
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .bind('vapid', JSON.stringify(keys))
    .run();
  const saved = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('vapid')
    .first<{ value: string }>();
  return saved === null ? keys : (JSON.parse(saved.value) as VapidKeys);
}

function vapidSubject(env: Env): string {
  return env.VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT;
}

/** 購読の登録・更新。同じ端末 (endpoint) からの再登録は上書きになる。 */
async function saveReminder(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('JSON として読めません。', 400, headers);
  }
  const value = body as Record<string, unknown>;

  const endpoint = typeof value.endpoint === 'string' ? value.endpoint : '';
  if (endpoint === '' || !/^https:\/\//.test(endpoint)) {
    return fail('通知の宛先が不正です。', 400, headers);
  }
  const time = typeof value.time === 'string' ? value.time : '';
  if (parseTime(time) === null) {
    return fail('時刻は HH:MM の形式で指定してください。', 400, headers);
  }
  const timeZone = typeof value.timeZone === 'string' && value.timeZone !== '' ? value.timeZone : 'UTC';
  const weekdays = normalizeWeekdays(value.weekdays);
  const enabled = value.enabled === false ? 0 : 1;

  const codeHash = await hashCode(code);
  const space = await env.DB.prepare('SELECT code_hash FROM spaces WHERE code_hash = ?')
    .bind(codeHash)
    .first<{ code_hash: string }>();
  if (space === null) return fail('この同期コードは見つかりませんでした。', 404, headers);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO reminders (endpoint, code_hash, time, time_zone, weekdays, enabled, last_sent_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       code_hash = excluded.code_hash,
       time = excluded.time,
       time_zone = excluded.time_zone,
       weekdays = excluded.weekdays,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(endpoint, codeHash, time, timeZone, JSON.stringify(weekdays), enabled, now, now)
    .run();

  return json({ ok: true, time, timeZone, weekdays, enabled: enabled === 1 }, 200, headers);
}

/** いま登録されている設定を返す。端末を変えたときに現状を見せるため。 */
async function readReminder(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  const endpoint = new URL(request.url).searchParams.get('endpoint') ?? '';
  if (endpoint === '') return fail('通知の宛先が指定されていません。', 400, headers);

  const row = await env.DB.prepare(
    'SELECT time, time_zone, weekdays, enabled FROM reminders WHERE endpoint = ? AND code_hash = ?',
  )
    .bind(endpoint, await hashCode(code))
    .first<{ time: string; time_zone: string; weekdays: string; enabled: number }>();

  if (row === null) return json({ registered: false }, 200, headers);
  return json(
    {
      registered: true,
      time: row.time,
      timeZone: row.time_zone,
      weekdays: normalizeWeekdays(JSON.parse(row.weekdays)),
      enabled: row.enabled === 1,
    },
    200,
    headers,
  );
}

async function deleteReminder(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  let endpoint = new URL(request.url).searchParams.get('endpoint') ?? '';
  if (endpoint === '') {
    try {
      const body = (await request.json()) as { endpoint?: unknown };
      if (typeof body.endpoint === 'string') endpoint = body.endpoint;
    } catch {
      /* body 無しでも許す */
    }
  }
  if (endpoint === '') return fail('通知の宛先が指定されていません。', 400, headers);

  await env.DB.prepare('DELETE FROM reminders WHERE endpoint = ? AND code_hash = ?')
    .bind(endpoint, await hashCode(code))
    .run();
  return json({ ok: true }, 200, headers);
}

/** 設定した内容で実際に届くか、その場で試す。 */
async function sendTestPush(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const code = readCode(request);
  if (code === null) return fail('同期コードが指定されていません。', 401, headers);

  let endpoint = '';
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint === 'string') endpoint = body.endpoint;
  } catch {
    /* 下でまとめて弾く */
  }
  if (endpoint === '') return fail('通知の宛先が指定されていません。', 400, headers);

  const row = await env.DB.prepare('SELECT endpoint FROM reminders WHERE endpoint = ? AND code_hash = ?')
    .bind(endpoint, await hashCode(code))
    .first<{ endpoint: string }>();
  if (row === null) return fail('この端末はまだ通知を登録していません。', 404, headers);

  const result = await sendPush({ endpoint }, await loadVapidKeys(env), vapidSubject(env));
  if (result.status === 'gone') {
    await env.DB.prepare('DELETE FROM reminders WHERE endpoint = ?').bind(endpoint).run();
    return fail('この端末の通知は無効になっています。登録し直してください。', 410, headers);
  }
  if (result.status === 'failed') {
    return fail(`通知を送れませんでした (${result.code})。`, 502, headers);
  }
  return json({ ok: true }, 200, headers);
}

/**
 * いま送るべき購読を探して送る。定時実行から呼ばれる。
 *
 * 予定が入っていない日 (すべて休養日、または今日の分をすでに終えた日) には
 * 送らない。同期しているデータをサーバーも持っているので、それを見て判断する。
 */
export async function deliverDueReminders(env: Env, now = new Date()): Promise<number> {
  const rows = await env.DB.prepare(
    'SELECT endpoint, time, time_zone, weekdays, enabled, last_sent_on FROM reminders WHERE enabled = 1',
  ).all<ReminderRow>();

  const keys = await loadVapidKeys(env);
  const subject = vapidSubject(env);
  let sent = 0;

  for (const row of rows.results ?? []) {
    const reminder: Reminder = {
      time: row.time,
      timeZone: row.time_zone,
      weekdays: normalizeWeekdays(JSON.parse(row.weekdays)),
      enabled: row.enabled === 1,
      lastSentOn: row.last_sent_on,
    };

    const check = checkDue(reminder, now);
    if (!check.due || check.localDate === undefined) continue;

    const result = await sendPush({ endpoint: row.endpoint }, keys, subject);
    if (result.status === 'gone') {
      await env.DB.prepare('DELETE FROM reminders WHERE endpoint = ?').bind(row.endpoint).run();
      continue;
    }
    if (result.status === 'failed') {
      console.error('プッシュの送信に失敗しました', result.code, result.message);
      continue;
    }

    // 同じ日に二度送らないよう、送れた日を記録する。
    await env.DB.prepare('UPDATE reminders SET last_sent_on = ? WHERE endpoint = ?')
      .bind(check.localDate, row.endpoint)
      .run();
    sent += 1;
  }

  return sent;
}
