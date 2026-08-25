import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 想定外の例外で画面全体が真っ白になるのを防ぐ。
 * データは localStorage に残っているので、再読み込みで復帰できることを伝える。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('画面の描画に失敗しました', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-3xl" aria-hidden>
          ⚠️
        </p>
        <h2 className="mt-2 font-semibold text-rose-900">画面を表示できませんでした</h2>
        <p className="mt-1 text-sm text-rose-800">
          保存したデータは残っています。再読み込みしてもう一度お試しください。
        </p>
        <p className="mt-3 break-words rounded-lg bg-white/70 px-3 py-2 text-left text-xs text-rose-700">
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          再読み込み
        </button>
      </div>
    );
  }
}
