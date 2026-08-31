/**
 * Web Push の送信。
 *
 * 中身 (ペイロード) を付けずに送っている。中身を運ぶには相手の公開鍵で
 * 暗号化する手順が要るが、ここで伝えたいのは「時間だよ」という合図だけで、
 * 具体的な文面は端末側が持っている。空のプッシュなら署名 (VAPID) だけで済む。
 *
 * VAPID は「この通知は確かにこのサーバーが出した」ことを示す仕組みで、
 * P-256 の鍵で署名した JWT を Authorization ヘッダーに載せる。
 */

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type VapidKeys = {
  /** 端末に渡す公開鍵 (base64url、65バイトの非圧縮形式) */
  publicKey: string;
  /** 署名に使う秘密鍵 (base64url、PKCS#8) */
  privateKey: string;
};

/** VAPID 用の鍵ペアを新しく作る。 */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const privateKey = (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer;
  return { publicKey: base64UrlEncode(publicKey), privateKey: base64UrlEncode(privateKey) };
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    base64UrlDecode(privateKey) as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * VAPID の JWT を作る。
 * aud には送信先エンドポイントのオリジンを入れる決まりになっている。
 */
export async function createVapidToken(
  keys: VapidKeys,
  audience: string,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        // 有効期限は 12 時間。仕様上 24 時間以内であればよい。
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importPrivateKey(keys.privateKey),
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export type PushSubscriptionRecord = {
  endpoint: string;
};

export type PushResult =
  | { status: 'sent' }
  /** 相手側で購読が無効になっている。登録を消してよい。 */
  | { status: 'gone' }
  | { status: 'failed'; code: number; message: string };

/**
 * 空のプッシュを1件送る。
 * 404 / 410 は「もう届かない購読」なので、呼び出し側で削除する。
 */
export async function sendPush(
  subscription: PushSubscriptionRecord,
  keys: VapidKeys,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  let audience: string;
  try {
    audience = new URL(subscription.endpoint).origin;
  } catch {
    return { status: 'failed', code: 0, message: 'エンドポイントの形式が不正です。' };
  }

  const token = await createVapidToken(keys, audience, subject);

  let response: Response;
  try {
    response = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${token}, k=${keys.publicKey}`,
        TTL: '600',
        // 中身が無いことを明示する。
        'Content-Length': '0',
        Urgency: 'high',
      },
    });
  } catch (error) {
    return {
      status: 'failed',
      code: 0,
      message: error instanceof Error ? error.message : '送信に失敗しました。',
    };
  }

  if (response.status === 404 || response.status === 410) return { status: 'gone' };
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    return { status: 'failed', code: response.status, message: message.slice(0, 200) };
  }
  return { status: 'sent' };
}
