import { describe, expect, it } from 'vitest';
import { CATCH_UP_MINUTES, checkDue, localNow, normalizeWeekdays, parseTime } from './reminders';
import type { Reminder } from './reminders';

/** 東京時間の指定時刻を Date にする (東京は UTC+9 で夏時間なし)。 */
function tokyo(dateTime: string): Date {
  return new Date(`${dateTime}+09:00`);
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    time: '07:00',
    timeZone: 'Asia/Tokyo',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    lastSentOn: null,
    ...overrides,
  };
}

describe('parseTime', () => {
  it('HH:MM を分に直す', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('07:30')).toBe(450);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime(' 7:05 ')).toBe(425);
  });

  it('読めない値は null', () => {
    for (const value of ['', '7', '25:00', '07:60', '7:5', 'abc', '07-30']) {
      expect(parseTime(value)).toBeNull();
    }
  });
});

describe('localNow', () => {
  it('指定したタイムゾーンでの日時に直す', () => {
    // UTC 2026-09-01 22:30 は東京では 09-02 07:30 (水)
    const local = localNow(new Date('2026-09-01T22:30:00Z'), 'Asia/Tokyo');
    expect(local).toEqual({ date: '2026-09-02', hour: 7, minute: 30, weekday: 3 });
  });

  it('日付をまたぐ側のタイムゾーンも正しい', () => {
    // 同じ瞬間はニューヨークでは 09-01 18:30 (火)
    const local = localNow(new Date('2026-09-01T22:30:00Z'), 'America/New_York');
    expect(local).toEqual({ date: '2026-09-01', hour: 18, minute: 30, weekday: 2 });
  });

  it('夏時間の切り替わりに追従する', () => {
    // ニューヨークの夏時間は 2026-03-08 に始まる
    const before = localNow(new Date('2026-03-08T06:30:00Z'), 'America/New_York');
    const after = localNow(new Date('2026-03-08T07:30:00Z'), 'America/New_York');
    expect(before?.hour).toBe(1); // EST (UTC-5)
    expect(after?.hour).toBe(3); // EDT (UTC-4) に切り替わり 2 時台が飛ぶ
  });

  it('不正なタイムゾーンは null', () => {
    expect(localNow(new Date(), 'Nowhere/Nothing')).toBeNull();
  });
});

describe('checkDue', () => {
  it('設定時刻ちょうどに送る', () => {
    const result = checkDue(reminder(), tokyo('2026-09-02T07:00:00'));
    expect(result.due).toBe(true);
    expect(result.localDate).toBe('2026-09-02');
  });

  it('時刻より前は送らない', () => {
    expect(checkDue(reminder(), tokyo('2026-09-02T06:59:00')).reason).toBe('not-yet');
  });

  it('定時実行が遅れても猶予の間は送る', () => {
    const late = tokyo(`2026-09-02T07:${String(CATCH_UP_MINUTES).padStart(2, '0')}:00`);
    expect(checkDue(reminder(), late).due).toBe(true);
  });

  it('猶予を過ぎたら送らない (寝ている間に届かない)', () => {
    const tooLate = tokyo(`2026-09-02T07:${String(CATCH_UP_MINUTES + 1).padStart(2, '0')}:00`);
    expect(checkDue(reminder(), tooLate).reason).toBe('not-yet');
  });

  it('同じ日に二度送らない', () => {
    const already = reminder({ lastSentOn: '2026-09-02' });
    expect(checkDue(already, tokyo('2026-09-02T07:00:00')).reason).toBe('already-sent');
    // 翌日になれば送る
    expect(checkDue(already, tokyo('2026-09-03T07:00:00')).due).toBe(true);
  });

  it('選んでいない曜日は送らない', () => {
    // 2026-09-02 は水曜 (3)
    const weekdaysOnly = reminder({ weekdays: [1, 2, 4, 5] });
    expect(checkDue(weekdaysOnly, tokyo('2026-09-02T07:00:00')).reason).toBe('other-weekday');
    // 木曜 (4) なら送る
    expect(checkDue(weekdaysOnly, tokyo('2026-09-03T07:00:00')).due).toBe(true);
  });

  it('オフなら送らない', () => {
    expect(checkDue(reminder({ enabled: false }), tokyo('2026-09-02T07:00:00')).reason).toBe(
      'disabled',
    );
  });

  it('設定が壊れていても落ちない', () => {
    expect(checkDue(reminder({ time: 'xx' }), new Date()).reason).toBe('bad-time');
    expect(checkDue(reminder({ timeZone: 'Nowhere/Nothing' }), new Date()).reason).toBe(
      'bad-timezone',
    );
  });

  it('日付をまたいだ直後に前日の分を送らない', () => {
    // 23:50 設定で、日付が変わった 00:05 に判定しても送らない
    const night = reminder({ time: '23:50' });
    expect(checkDue(night, tokyo('2026-09-03T00:05:00')).reason).toBe('not-yet');
    expect(checkDue(night, tokyo('2026-09-02T23:50:00')).due).toBe(true);
  });

  it('タイムゾーンが違えば送る瞬間も変わる', () => {
    const tokyoUser = reminder({ timeZone: 'Asia/Tokyo' });
    const nyUser = reminder({ timeZone: 'America/New_York' });
    // UTC 2026-09-01 22:00 は東京 07:00 / NY 18:00
    const moment = new Date('2026-09-01T22:00:00Z');
    expect(checkDue(tokyoUser, moment).due).toBe(true);
    expect(checkDue(nyUser, moment).due).toBe(false);
  });

  it('1日ぶんを通しても送るのは1回だけ', () => {
    let state = reminder();
    let sent = 0;
    // 06:00 から 08:00 まで1分ずつ進める
    for (let minute = 0; minute <= 120; minute += 1) {
      const now = new Date(tokyo('2026-09-02T06:00:00').getTime() + minute * 60_000);
      const result = checkDue(state, now);
      if (result.due && result.localDate !== undefined) {
        sent += 1;
        state = { ...state, lastSentOn: result.localDate };
      }
    }
    expect(sent).toBe(1);
  });
});

describe('normalizeWeekdays', () => {
  it('正しい配列はそのまま (重複と順序は整える)', () => {
    expect(normalizeWeekdays([3, 1, 1, 5])).toEqual([1, 3, 5]);
  });

  it('壊れた値や空は毎日に倒す', () => {
    const everyday = [0, 1, 2, 3, 4, 5, 6];
    expect(normalizeWeekdays(null)).toEqual(everyday);
    expect(normalizeWeekdays('x')).toEqual(everyday);
    expect(normalizeWeekdays([])).toEqual(everyday);
    expect(normalizeWeekdays([9, -1, 'a'])).toEqual(everyday);
  });
});
