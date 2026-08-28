/**
 * StudySchedule の同期サーバー (Cloudflare Workers + D1)。
 *
 * やることは1つだけ: 同期コードごとに JSON をひとつ預かり、読み書きさせる。
 * データの中身の解釈やマージはクライアント側で完結させ、ここでは触らない。
 *
 * 認証は「同期コードを知っていること」だけ。コードは Authorization ヘッダーで送り、
 * サーバーには SHA-256 のハッシュだけを保存する。
 *
 * エンドポイント:
 *   POST /api/space        新しい同期コードを発行する
 *   GET  /api/space        今のデータを取得する      (Authorization: Bearer <code>)
 *   PUT  /api/space        データを保存する          (Authorization + If-Match: <revision>)
 *   GET  /api/health       疎通確認
 */

export type Env = {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
};

/** 保存できる JSON の上限。D1 の行サイズと悪用の両方を抑える。 */
const MAX_BODY_BYTES = 1_000_000;
/** 同期コードの長さ (Base32 相当の文字数)。約 130 ビットの乱数。 */
const CODE_LENGTH = 26;
/** 紛らわしい文字 (0/O, 1/I/L) を除いた英数字。口頭や手入力でも間違えにくい。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

    if (url.pathname === '/api/health') {
      return json({ ok: true }, 200, headers);
    }
    if (url.pathname !== '/api/space') {
      return fail('見つかりません。', 404, headers);
    }

    try {
      if (request.method === 'POST') return await createSpace(env, headers);
      if (request.method === 'GET') return await readSpace(request, env, headers);
      if (request.method === 'PUT') return await writeSpace(request, env, headers);
      return fail('このメソッドは使えません。', 405, headers);
    } catch (error) {
      console.error(error);
      return fail('サーバー側でエラーが発生しました。', 500, headers);
    }
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
