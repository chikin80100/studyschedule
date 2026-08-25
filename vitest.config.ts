import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 日付は暦日として扱うため、実行環境のタイムゾーンに影響されないことを固定して確かめる。
    env: { TZ: process.env.TZ ?? 'Asia/Tokyo' },
  },
});
