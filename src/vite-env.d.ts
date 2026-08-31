/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 同期・通知サーバーの URL。省略すると本番の Worker を使う。 */
  readonly VITE_SYNC_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
