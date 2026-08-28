import type { AppData } from '../types';
import { parseAppData } from '../storage';
import { mergeAppData } from './sync';
import type { SyncSettings } from './sync';

export type RemoteSnapshot = {
  revision: string;
  updatedAt: string;
  data: AppData;
};

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

function endpoint(apiBase: string, path = '/api/space'): string {
  return `${apiBase.replace(/\/+$/, '')}${path}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error;
    }
  } catch {
    /* JSON でなければ既定の文言を使う */
  }
  return fallback;
}

/** 新しい同期コードを発行する。返ってきたコードは他の端末で入力してもらう。 */
export async function createSyncCode(apiBase: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(endpoint(apiBase), { method: 'POST', signal });
  if (!response.ok) {
    throw new SyncError(await readError(response, '同期コードを発行できませんでした。'));
  }
  const body: unknown = await response.json();
  const code = (body as { code?: unknown }).code;
  if (typeof code !== 'string' || code === '') {
    throw new SyncError('サーバーの応答が想定と違います。');
  }
  return code;
}

/** サーバーの現在の内容を取得する。 */
export async function fetchRemote(
  settings: SyncSettings,
  signal?: AbortSignal,
): Promise<RemoteSnapshot> {
  const response = await fetch(endpoint(settings.apiBase), {
    headers: { Authorization: `Bearer ${settings.code}` },
    signal,
  });
  if (response.status === 404) {
    throw new SyncError('この同期コードは見つかりませんでした。入力を確認してください。');
  }
  if (!response.ok) {
    throw new SyncError(await readError(response, 'サーバーからデータを取得できませんでした。'));
  }
  return toSnapshot(await response.json());
}

/** サーバーから受け取った中身も外部入力として検証してから使う。 */
function toSnapshot(body: unknown): RemoteSnapshot {
  const value = body as { revision?: unknown; updatedAt?: unknown; data?: unknown };
  if (typeof value?.revision !== 'string') {
    throw new SyncError('サーバーの応答が想定と違います。');
  }
  return {
    revision: value.revision,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    data: parseAppData(value.data).data,
  };
}

export type SyncResult = {
  /** マージ後のデータ。これをローカルにも保存する。 */
  data: AppData;
  revision: string;
  syncedAt: string;
};

/**
 * ローカルのデータをサーバーと突き合わせる。
 *
 *   1. サーバーの現在の内容を取得する
 *   2. ローカルとマージする (どちらの記録も消さない)
 *   3. 取得したときの revision を付けて保存する
 *
 * 2 と 3 の間に他の端末が保存していた場合はサーバーが 409 と最新データを返すので、
 * それをマージし直してもう一度送る。何度も競合するのは異常なので上限を設ける。
 */
export async function syncNow(
  settings: SyncSettings,
  local: AppData,
  signal?: AbortSignal,
  maxAttempts = 3,
): Promise<SyncResult> {
  let remote = await fetchRemote(settings, signal);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const merged = mergeAppData(local, remote.data);
    const response = await fetch(endpoint(settings.apiBase), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${settings.code}`,
        'Content-Type': 'application/json',
        'If-Match': remote.revision,
      },
      body: JSON.stringify(merged),
      signal,
    });

    if (response.status === 409) {
      // 別の端末が先に保存していた。返ってきた最新データを取り込んでやり直す。
      remote = toSnapshot(await response.json());
      continue;
    }
    if (!response.ok) {
      throw new SyncError(await readError(response, 'サーバーに保存できませんでした。'));
    }

    const body: unknown = await response.json();
    const revision = (body as { revision?: unknown }).revision;
    return {
      data: merged,
      revision: typeof revision === 'string' ? revision : remote.revision,
      syncedAt: new Date().toISOString(),
    };
  }

  throw new SyncError('他の端末の更新と重なり続けています。少し待ってからもう一度お試しください。');
}
