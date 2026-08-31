import { describe, expect, it } from 'vitest';
import { subscribeErrorMessage } from './useReminder';

describe('subscribeErrorMessage', () => {
  it('許可が下りていないときは設定を促す', () => {
    const message = subscribeErrorMessage(new Error('Registration failed - permission denied'));
    expect(message).toContain('許可');
  });

  it('プッシュサービスに繋がらないときは接続を疑わせる', () => {
    const error = new Error('Registration failed - push service error');
    expect(subscribeErrorMessage(error)).toContain('ネットワーク');
  });

  it('中断されたときも接続の案内にする', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(subscribeErrorMessage(error)).toContain('ネットワーク');
  });

  it('鍵が前回と違うときは入れ直しを促す', () => {
    const error = new Error('Registration failed - A subscription with a different applicationServerKey already exists');
    expect(subscribeErrorMessage(error)).toContain('オフ');
  });

  it('分からない理由でも日本語で返す', () => {
    expect(subscribeErrorMessage(new Error('something odd'))).toBe(
      '通知の登録に失敗しました。時間をおいて、もう一度お試しください。',
    );
  });

  it('Error でなくても落ちない', () => {
    expect(subscribeErrorMessage('boom')).toBeTruthy();
    expect(subscribeErrorMessage(undefined)).toBeTruthy();
  });

  it('どの理由でも英語をそのまま出さない', () => {
    const cases = [
      new Error('Registration failed - permission denied'),
      new Error('Registration failed - push service error'),
      new Error('unknown'),
    ];
    for (const error of cases) {
      expect(subscribeErrorMessage(error)).not.toContain('Registration failed');
    }
  });
});
