#!/usr/bin/env node
/**
 * D1 にテーブルを作る。
 *
 * `wrangler d1 execute --file=...` は Cloudflare の import API を通る。
 * これは「ファイルを分割してアップロードし、ハッシュを突き合わせてから実行する」
 * 仕組みで、途中の経路や文字コードの扱いで失敗することがある
 * (A request to the Cloudflare API (/d1/database/.../import) failed)。
 *
 * ここで実行するのはテーブルを作る数行だけなので、import を使わず
 * 通常のクエリとして送る。こちらは1回のリクエストで完結する。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');
const DATABASE = 'studyschedule';

const remote = process.argv.includes('--remote');
const where = remote ? '--remote' : '--local';
const label = remote ? 'Cloudflare 上の' : 'ローカルの';

/** SQL からコメントを取り除き、1文ずつに分ける。 */
function statements(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0);
}

function run(sql) {
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', DATABASE, where, '--command', sql, '--yes'],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'inherit'] },
  );
}

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

console.log(`${label}データベース "${DATABASE}" にテーブルを用意します。`);
console.log('すでにあるものはそのまま残るので、何度実行しても大丈夫です。\n');

for (const file of files) {
  const sql = statements(readFileSync(join(MIGRATIONS, file), 'utf8'));
  try {
    for (const statement of sql) run(statement);
    console.log(`  ${file} … 完了 (${sql.length}件)`);
  } catch {
    console.error(`\n${file} の適用に失敗しました。上のメッセージを確認してください。`);
    console.error('よくある原因:');
    console.error(`  - ログインしていない            → npx wrangler login`);
    console.error(`  - wrangler.toml の database_id が違う → npx wrangler d1 list で確認`);
    process.exit(1);
  }
}

console.log('\nすべて完了しました。');
