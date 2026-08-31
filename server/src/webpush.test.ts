import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  createVapidToken,
  generateVapidKeys,
  sendPush,
} from './webpush';

const ENDPOINT = 'https://push.example.com/send/abc123';

describe('base64url', () => {
  it('往復して元に戻る', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it('URL に使えない文字を含まない', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('VAPID', () => {
  it('P-256 の鍵ペアを作る', async () => {
    const keys = await generateVapidKeys();
    // 公開鍵は非圧縮形式の 65 バイトで、先頭が 0x04
    const publicKey = base64UrlDecode(keys.publicKey);
    expect(publicKey.length).toBe(65);
    expect(publicKey[0]).toBe(0x04);
    expect(base64UrlDecode(keys.privateKey).length).toBeGreaterThan(0);
  });

  it('作った署名が公開鍵で検証できる', async () => {
    const keys = await generateVapidKeys();
    const token = await createVapidToken(keys, 'https://push.example.com', 'mailto:a@example.com');

    const [header, payload, signature] = token.split('.');
    expect(header).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(signature).toBeTruthy();

    const publicKey = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlDecode(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it('ヘッダーとペイロードが仕様どおり', async () => {
    const keys = await generateVapidKeys();
    const now = Date.UTC(2026, 8, 1, 0, 0, 0);
    const token = await createVapidToken(
      keys,
      'https://push.example.com',
      'mailto:me@example.com',
      now,
    );
    const [header, payload] = token.split('.');
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));

    expect(decode(header)).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = decode(payload);
    expect(claims.aud).toBe('https://push.example.com');
    expect(claims.sub).toBe('mailto:me@example.com');
    // 有効期限は 24 時間以内でなければならない
    expect(claims.exp).toBeGreaterThan(Math.floor(now / 1000));
    expect(claims.exp - Math.floor(now / 1000)).toBeLessThanOrEqual(24 * 60 * 60);
  });
});

describe('sendPush', () => {
  it('署名付きで中身の無いリクエストを送る', async () => {
    const keys = await generateVapidKeys();
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendPush({ endpoint: ENDPOINT }, keys, 'mailto:me@example.com', fakeFetch);

    expect(result).toEqual({ status: 'sent' });
    expect(seen).not.toBeNull();
    const sent = seen as unknown as { url: string; init: RequestInit };
    expect(sent.url).toBe(ENDPOINT);
    expect(sent.init.method).toBe('POST');
    expect(sent.init.body).toBeUndefined();

    const headers = sent.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(headers.Authorization).toContain(keys.publicKey);
    expect(headers.TTL).toBe('600');
  });

  it('宛先ごとに aud を変える', async () => {
    const keys = await generateVapidKeys();
    const seen: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      const payload = auth.split('t=')[1].split(',')[0].split('.')[1];
      seen.push(JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))).aud);
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    await sendPush({ endpoint: 'https://a.example.com/x' }, keys, 'mailto:m@e.com', fakeFetch);
    await sendPush({ endpoint: 'https://b.example.com/y' }, keys, 'mailto:m@e.com', fakeFetch);
    expect(seen).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('404 と 410 は「もう届かない」と伝える', async () => {
    const keys = await generateVapidKeys();
    for (const status of [404, 410]) {
      const fakeFetch = (async () => new Response(null, { status })) as unknown as typeof fetch;
      const result = await sendPush({ endpoint: ENDPOINT }, keys, 'mailto:m@e.com', fakeFetch);
      expect(result).toEqual({ status: 'gone' });
    }
  });

  it('その他の失敗は理由を返す', async () => {
    const keys = await generateVapidKeys();
    const fakeFetch = (async () =>
      new Response('too many requests', { status: 429 })) as unknown as typeof fetch;
    const result = await sendPush({ endpoint: ENDPOINT }, keys, 'mailto:m@e.com', fakeFetch);
    expect(result).toEqual({ status: 'failed', code: 429, message: 'too many requests' });
  });

  it('通信そのものが失敗しても例外を投げない', async () => {
    const keys = await generateVapidKeys();
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await sendPush({ endpoint: ENDPOINT }, keys, 'mailto:m@e.com', fakeFetch);
    expect(result).toEqual({ status: 'failed', code: 0, message: 'network down' });
  });

  it('宛先が URL でなければ送らない', async () => {
    const keys = await generateVapidKeys();
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await sendPush({ endpoint: 'not-a-url' }, keys, 'mailto:m@e.com', fakeFetch);
    expect(result.status).toBe('failed');
    expect(called).toBe(false);
  });
});
