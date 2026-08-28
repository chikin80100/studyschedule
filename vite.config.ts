import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/studyschedule/',
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // server/ は同期サーバー (Cloudflare Worker) のコード。
      // ローカルで wrangler dev を動かすと .wrangler/ 配下の D1 ファイルが
      // 書き換わり続けるので、監視対象から外さないと画面が再読み込みし続ける。
      ignored: ['**/server/**'],
    },
  },
});
