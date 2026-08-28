-- 同期コードひとつにつき1行。データはアプリの AppData をそのまま JSON で持つ。
-- 同期コードは平文では持たず、SHA-256 のハッシュだけを保存する。
-- こうしておけば、万一 DB の中身が漏れても他人のデータを読むための鍵にはならない。
CREATE TABLE IF NOT EXISTS spaces (
  code_hash  TEXT PRIMARY KEY,
  -- 楽観ロック用。保存のたびに新しい値になる。
  revision   TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 使われなくなった領域を後から掃除できるように。
CREATE INDEX IF NOT EXISTS idx_spaces_updated_at ON spaces (updated_at);
