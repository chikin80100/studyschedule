/** 0=日曜 ... 6=土曜 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 曜日ごとの学習量の設定。 */
export type WeekdaySetting = {
  dayOfWeek: DayOfWeek;
  /** true ならこの曜日にはタスクを作らない(休養日)。 */
  isRestDay: boolean;
  /**
   * 休養日でない日の相対的な配分量。大きいほど多く割り当てられる。
   * 0 は「この曜日は学習しない」を意味し、休養日と同じ扱いになる。
   */
  weight: number;
};

/** 1日分のタスク。study は計画量のある日、buffer は挽回用に空けた予備日。 */
export type TaskKind = 'study' | 'buffer';

export type Task = {
  id: string;
  planId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  kind: TaskKind;
  /** 予備日は常に 0。 */
  plannedAmount: number;
  doneAmount: number;
  isCompleted: boolean;
  /**
   * 「この日はどうだったか」を確認した日 ('YYYY-MM-DD')。未確認なら null。
   * 終わらなかった日を「確認済み」にして、毎日の確認リストから外すために使う。
   */
  checkedAt: string | null;
  /**
   * 再計画によってこの日の計画が置き換わった日 ('YYYY-MM-DD')。置き換わっていなければ null。
   * 置き換わった日は「その日にやった量」で確定済みとして扱い、遅れの計算に含めない。
   * plannedAmount はそのまま残すので、連続達成記録の履歴(その日は達成できなかった)は失われない。
   */
  supersededAt: string | null;
  /**
   * この日の記録 (doneAmount / isCompleted / checkedAt) を最後に変えた時刻 (ISO 8601)。
   * 端末間の同期で、どちらの記録を採用するかの判断に使う。
   */
  updatedAt: string;
};

/** 1日あたりの量を切り上げる単位。'auto' なら平均量から自動で選ぶ。 */
export type RoundingStep = number | 'auto';

export type Plan = {
  id: string;
  /** 学習内容 (例: 数学の問題集) */
  title: string;
  /** 量の単位 (例: ページ / 問 / 分) */
  unit: string;
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
  totalAmount: number;
  /** 0〜6 の曜日がひとつずつ揃った長さ 7 の配列。 */
  weekdaySettings: WeekdaySetting[];
  /** 期間の末尾に予備日として残す学習日の割合 (0〜0.5)。 */
  bufferRatio: number;
  roundingStep: RoundingStep;
  /** ISO 8601 */
  createdAt: string;
  /**
   * プランの設定、またはタスクの組み方 (日付・計画量) を最後に変えた時刻 (ISO 8601)。
   * 同期では「新しいほうのプランが持つタスクの並び」を採用するので、
   * 再計画のようにタスクだけを組み直す操作でもここを更新する。
   */
  updatedAt: string;
};

/** 削除したプランの記録。同期のときに他の端末から復活しないようにするために残す。 */
export type PlanDeletion = {
  planId: string;
  /** ISO 8601 */
  deletedAt: string;
};

/** 保存データ。version は将来のマイグレーション用。 */
export const CURRENT_DATA_VERSION = 2;

export type AppData = {
  version: typeof CURRENT_DATA_VERSION;
  plans: Plan[];
  tasks: Task[];
  /** 削除済みプランの記録 (トゥームストーン)。 */
  deletions: PlanDeletion[];
};

/**
 * 「まだ一度も記録が付いていない」ことを表す時刻。
 * 生成されたばかりのタスクや、更新時刻を持たない v1 データに使う。
 * 同期では必ず実際の記録に負けるので、他の端末の記録を消してしまわない。
 */
export const NEVER_UPDATED = '1970-01-01T00:00:00.000Z';

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export const DAYS_OF_WEEK: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

export function createDefaultWeekdaySettings(): WeekdaySetting[] {
  return DAYS_OF_WEEK.map((dayOfWeek) => ({ dayOfWeek, isRestDay: false, weight: 1 }));
}
