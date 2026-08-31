-- 「勉強開始のお知らせ」の購読。同期コード1つにつき、端末ごとに1行。
-- 同期コードは平文で持たず、spaces と同じくハッシュで参照する。
CREATE TABLE IF NOT EXISTS reminders (
  -- プッシュの宛先。端末ごとに一意なので主キーにする。
  endpoint    TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  -- 利用者の地域での時刻 'HH:MM'
  time        TEXT NOT NULL,
  -- IANA タイムゾーン (例: Asia/Tokyo)
  time_zone   TEXT NOT NULL,
  -- 通知する曜日の JSON 配列 (0=日 ... 6=土)
  weekdays    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  -- 最後に送った日 (利用者の地域での 'YYYY-MM-DD')。二重送信を防ぐ。
  last_sent_on TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 定時実行で「有効なものだけ」を走査するため。
CREATE INDEX IF NOT EXISTS idx_reminders_enabled ON reminders (enabled);
CREATE INDEX IF NOT EXISTS idx_reminders_code_hash ON reminders (code_hash);

-- VAPID の鍵など、サーバー全体で1組だけ持つ値。
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
