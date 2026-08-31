/**
 * 「いま通知を送るべきか」の判定。
 *
 * 端末の時計ではなくサーバー側で判断するので、利用者の地域 (IANA タイムゾーン)
 * を保存しておき、そこでの壁時計の時刻に合わせて送る。オフセットではなく
 * タイムゾーン名で持つのは、夏時間の切り替わりを自動で追従させるため。
 */

export type Reminder = {
  /** 'HH:MM' 形式の、利用者の地域での時刻 */
  time: string;
  /** IANA タイムゾーン (例: 'Asia/Tokyo') */
  timeZone: string;
  /** 通知する曜日。0=日 ... 6=土 */
  weekdays: number[];
  enabled: boolean;
  /** 最後に送った日 ('YYYY-MM-DD'、利用者の地域での日付)。未送信なら null */
  lastSentOn: string | null;
};

/** 利用者の地域での「今」を、日付・時刻・曜日に分解する。 */
export type LocalNow = {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0〜23 */
  hour: number;
  /** 0〜59 */
  minute: number;
  /** 0=日 ... 6=土 */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * 指定したタイムゾーンでの現在時刻を求める。
 * タイムゾーン名が不正なら null (呼び出し側で送信を見送る)。
 */
export function localNow(now: Date, timeZone: string): LocalNow | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    return null;
  }

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const weekday = WEEKDAY_INDEX[get('weekday')];

  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (weekday === undefined) return null;

  return { date: `${year}-${month}-${day}`, hour, minute, weekday };
}

/** 'HH:MM' を分に直す。読めなければ null。 */
export function parseTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 定時実行が遅れたときに、どこまで遡って送るか (分)。 */
export const CATCH_UP_MINUTES = 10;

export type DueReason = 'due' | 'disabled' | 'bad-time' | 'bad-timezone' | 'other-weekday' | 'already-sent' | 'not-yet';

/**
 * いま送るべきかを返す。
 *
 * 定時実行が数分ずれても取りこぼさないよう、設定時刻から
 * CATCH_UP_MINUTES 分の間はまだ「送るべき」とみなす。
 * 1日に何度も鳴らないよう、送った日を記録して同じ日は二度送らない。
 */
export function checkDue(reminder: Reminder, now: Date): { due: boolean; reason: DueReason; localDate?: string } {
  if (!reminder.enabled) return { due: false, reason: 'disabled' };

  const target = parseTime(reminder.time);
  if (target === null) return { due: false, reason: 'bad-time' };

  const local = localNow(now, reminder.timeZone);
  if (local === null) return { due: false, reason: 'bad-timezone' };

  if (!reminder.weekdays.includes(local.weekday)) {
    return { due: false, reason: 'other-weekday', localDate: local.date };
  }
  if (reminder.lastSentOn === local.date) {
    return { due: false, reason: 'already-sent', localDate: local.date };
  }

  const current = local.hour * 60 + local.minute;
  const elapsed = current - target;
  // 日付をまたいだ直後 (elapsed が大きな負) は送らない。
  if (elapsed < 0 || elapsed > CATCH_UP_MINUTES) {
    return { due: false, reason: 'not-yet', localDate: local.date };
  }

  return { due: true, reason: 'due', localDate: local.date };
}

/** 保存された曜日の配列を検証する。不正なら毎日に倒す。 */
export function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
  const days = [...new Set(value)]
    .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
}
