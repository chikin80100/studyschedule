type Props = {
  /** 0〜1 */
  ratio: number;
  className?: string;
  tone?: 'indigo' | 'emerald' | 'amber';
};

const TONE_CLASS = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
} as const;

export default function ProgressBar({ ratio, className = '', tone = 'indigo' }: Props) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${TONE_CLASS[tone]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
