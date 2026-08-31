import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_API_BASE,
  isSameAppData,
  isSyncConfigured,
  loadSyncSettings,
  mergeAppData,
  stableStringify,
} from './sync';
import { parseAppData } from '../storage';
import { generateTasks } from './taskGenerator';
import { createDefaultWeekdaySettings } from '../types';
import type { AppData, Plan, Task } from '../types';

const T = {
  early: '2026-09-01T00:00:00.000Z',
  mid: '2026-09-02T00:00:00.000Z',
  late: '2026-09-03T00:00:00.000Z',
  latest: '2026-09-04T00:00:00.000Z',
};

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    title: '英単語',
    unit: '語',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    totalAmount: 50,
    weekdaySettings: createDefaultWeekdaySettings(),
    bufferRatio: 0,
    roundingStep: 1,
    createdAt: T.early,
    updatedAt: T.early,
    ...overrides,
  };
}

function makeData(plans: Plan[], tasks?: Task[], deletions: AppData['deletions'] = []): AppData {
  return {
    version: 2,
    plans,
    tasks: tasks ?? plans.flatMap((plan) => generateTasks(plan)),
    deletions,
  };
}

/** 指定した日付のタスクに実績を入れる。 */
function record(data: AppData, date: string, doneAmount: number, updatedAt: string): AppData {
  return {
    ...data,
    tasks: data.tasks.map((task) =>
      task.date === date
        ? { ...task, doneAmount, isCompleted: doneAmount >= task.plannedAmount, updatedAt }
        : task,
    ),
  };
}

const findTask = (data: AppData, date: string) => data.tasks.find((task) => task.date === date);

describe('mergeAppData: プランの採用', () => {
  it('片方にしかないプランは両方に残る', () => {
    const a = makeData([makePlan({ id: 'a' })]);
    const b = makeData([makePlan({ id: 'b', createdAt: T.mid })]);
    const merged = mergeAppData(a, b);
    expect(merged.plans.map((plan) => plan.id)).toEqual(['a', 'b']);
    expect(merged.tasks.filter((task) => task.planId === 'a')).toHaveLength(5);
    expect(merged.tasks.filter((task) => task.planId === 'b')).toHaveLength(5);
  });

  it('同じプランは updatedAt が新しいほうの設定を採用する', () => {
    const a = makeData([makePlan({ totalAmount: 50, updatedAt: T.early })]);
    const newer = makePlan({ totalAmount: 100, updatedAt: T.late });
    const b = makeData([newer]);
    expect(mergeAppData(a, b).plans[0].totalAmount).toBe(100);
    // 順序を入れ替えても結果は同じ
    expect(mergeAppData(b, a).plans[0].totalAmount).toBe(100);
  });

  it('新しいほうのタスクの並びを採用する', () => {
    // 期間を縮めたプランのほうが新しい
    const a = makeData([makePlan({ updatedAt: T.early })]);
    const shortened = makePlan({ endDate: '2026-09-03', updatedAt: T.late });
    const b = makeData([shortened]);
    const merged = mergeAppData(a, b);
    expect(merged.tasks.map((task) => task.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });
});

describe('mergeAppData: 記録のマージ', () => {
  it('別々の日に付けた記録が両方残る', () => {
    const base = makeData([makePlan()]);
    const a = record(base, '2026-09-01', 10, T.mid);
    const b = record(base, '2026-09-02', 10, T.mid);
    const merged = mergeAppData(a, b);
    expect(findTask(merged, '2026-09-01')?.doneAmount).toBe(10);
    expect(findTask(merged, '2026-09-02')?.doneAmount).toBe(10);
  });

  it('同じ日の記録は新しいほうを採用する', () => {
    const base = makeData([makePlan()]);
    const a = record(base, '2026-09-01', 3, T.mid);
    const b = record(base, '2026-09-01', 10, T.late);
    expect(findTask(mergeAppData(a, b), '2026-09-01')?.doneAmount).toBe(10);
    expect(findTask(mergeAppData(b, a), '2026-09-01')?.doneAmount).toBe(10);
  });

  it('プランを組み直した端末と、記録を付けた端末の両方が残る', () => {
    // A: 今日の分を終えた (プランは触っていない)
    const a = record(makeData([makePlan()]), '2026-09-01', 10, T.mid);
    // B: 期間を延ばして組み直した (記録は無い)
    const extended = makePlan({ endDate: '2026-09-10', totalAmount: 100, updatedAt: T.late });
    const b = makeData([extended]);

    const merged = mergeAppData(a, b);
    // 並びは B のもの
    expect(merged.tasks).toHaveLength(10);
    expect(merged.plans[0].totalAmount).toBe(100);
    // 記録は A のものが残る
    expect(findTask(merged, '2026-09-01')?.doneAmount).toBe(10);
  });

  it('新しい並びに無くなった日の記録は落ちる', () => {
    const a = record(makeData([makePlan()]), '2026-09-05', 10, T.mid);
    const b = makeData([makePlan({ endDate: '2026-09-03', updatedAt: T.late })]);
    const merged = mergeAppData(a, b);
    expect(findTask(merged, '2026-09-05')).toBeUndefined();
  });

  it('予備日には完了フラグを持ち込まない', () => {
    const a = makeData([makePlan()]);
    const withRecord: AppData = {
      ...a,
      tasks: a.tasks.map((task) =>
        task.date === '2026-09-01'
          ? { ...task, doneAmount: 10, isCompleted: true, updatedAt: T.late }
          : task,
      ),
    };
    // B 側では 09-01 が予備日になっている
    const bufferedPlan = makePlan({ bufferRatio: 0.5, updatedAt: T.latest });
    const b = makeData([bufferedPlan]);
    const merged = mergeAppData(withRecord, b);
    const target = findTask(merged, '2026-09-01');
    if (target?.kind === 'buffer') {
      expect(target.isCompleted).toBe(false);
      expect(target.doneAmount).toBe(10); // 実際にやった記録は残す
    }
  });

  it('確認済み・確定済みの印も新しいほうを採用する', () => {
    const base = makeData([makePlan()]);
    const a: AppData = {
      ...base,
      tasks: base.tasks.map((task) =>
        task.date === '2026-09-01' ? { ...task, checkedAt: '2026-09-02', updatedAt: T.mid } : task,
      ),
    };
    const b: AppData = {
      ...base,
      tasks: base.tasks.map((task) =>
        task.date === '2026-09-01'
          ? { ...task, checkedAt: '2026-09-03', supersededAt: '2026-09-03', updatedAt: T.late }
          : task,
      ),
    };
    const merged = mergeAppData(a, b);
    expect(findTask(merged, '2026-09-01')?.checkedAt).toBe('2026-09-03');
    expect(findTask(merged, '2026-09-01')?.supersededAt).toBe('2026-09-03');
  });
});

describe('mergeAppData: 削除', () => {
  it('片方で削除したプランは復活しない', () => {
    const a = makeData([makePlan()]);
    const b: AppData = {
      version: 2,
      plans: [],
      tasks: [],
      deletions: [{ planId: 'plan-1', deletedAt: T.late }],
    };
    const merged = mergeAppData(a, b);
    expect(merged.plans).toHaveLength(0);
    expect(merged.tasks).toHaveLength(0);
    expect(mergeAppData(b, a).plans).toHaveLength(0);
  });

  it('削除より後に更新したプランは残る', () => {
    const a = makeData([makePlan({ updatedAt: T.latest })]);
    const b: AppData = {
      version: 2,
      plans: [],
      tasks: [],
      deletions: [{ planId: 'plan-1', deletedAt: T.late }],
    };
    const merged = mergeAppData(a, b);
    expect(merged.plans).toHaveLength(1);
    // 復活したので削除記録は捨てる
    expect(merged.deletions).toHaveLength(0);
  });

  it('削除記録は新しいほうを残し、まだ有効なものだけ持ち越す', () => {
    const a: AppData = {
      version: 2,
      plans: [],
      tasks: [],
      deletions: [{ planId: 'gone', deletedAt: T.early }],
    };
    const b: AppData = {
      version: 2,
      plans: [],
      tasks: [],
      deletions: [{ planId: 'gone', deletedAt: T.late }],
    };
    expect(mergeAppData(a, b).deletions).toEqual([{ planId: 'gone', deletedAt: T.late }]);
  });
});

describe('内容の同一判定', () => {
  it('キーの並びが違っても同じと見なす', () => {
    // アプリがプランを作るときは draft を展開してから id を足すので、
    // 保存データを読み直したもの (id が先頭) とはキーの並びが変わる。
    const { id, createdAt, updatedAt, ...draft } = makePlan();
    const asBuiltByApp = { ...draft, id, createdAt, updatedAt } as Plan;
    const data = makeData([asBuiltByApp]);
    const roundTripped = parseAppData(JSON.parse(JSON.stringify(data))).data;

    expect(JSON.stringify(roundTripped)).not.toBe(JSON.stringify(data)); // 素の比較では違う
    expect(isSameAppData(roundTripped, data)).toBe(true);
  });

  it('中身が違えば違うと判定する', () => {
    const a = makeData([makePlan()]);
    const b = makeData([makePlan({ totalAmount: 999 })]);
    expect(isSameAppData(a, b)).toBe(false);
  });

  it('マージ結果を読み直しても同じと判定される (同期が止まらなくならない)', () => {
    const local = record(makeData([makePlan()]), '2026-09-01', 10, T.mid);
    const remote = makeData([makePlan()]);
    const merged = mergeAppData(local, remote);
    // サーバーに送って読み戻したものと、もう一度マージした結果が一致すること
    const fromServer = parseAppData(JSON.parse(JSON.stringify(merged))).data;
    expect(isSameAppData(mergeAppData(merged, fromServer), merged)).toBe(true);
  });

  it('stableStringify は配列の順序は保つ', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe('mergeAppData: 性質', () => {
  const a = record(makeData([makePlan({ id: 'x' })]), '2026-09-01', 10, T.mid);
  const b = record(
    makeData([makePlan({ id: 'x', totalAmount: 100, updatedAt: T.late })]),
    '2026-09-02',
    20,
    T.late,
  );

  it('引数の順序を入れ替えても同じ結果になる', () => {
    expect(mergeAppData(a, b)).toEqual(mergeAppData(b, a));
  });

  it('同じものをマージしても変わらない (べき等)', () => {
    const merged = mergeAppData(a, b);
    expect(mergeAppData(merged, merged)).toEqual(merged);
    expect(mergeAppData(merged, a)).toEqual(merged);
  });

  it('引数を書き換えない', () => {
    const snapshotA = JSON.stringify(a);
    const snapshotB = JSON.stringify(b);
    mergeAppData(a, b);
    expect(JSON.stringify(a)).toBe(snapshotA);
    expect(JSON.stringify(b)).toBe(snapshotB);
  });

  it('空データとマージしても中身が消えない', () => {
    const empty: AppData = { version: 2, plans: [], tasks: [], deletions: [] };
    expect(mergeAppData(a, empty)).toEqual(mergeAppData(empty, a));
    expect(mergeAppData(a, empty).plans).toHaveLength(1);
    expect(mergeAppData(a, empty).tasks).toHaveLength(a.tasks.length);
  });

  it('3端末を順にマージしても全員の記録が残る', () => {
    const base = makeData([makePlan()]);
    const d1 = record(base, '2026-09-01', 10, T.mid);
    const d2 = record(base, '2026-09-02', 10, T.mid);
    const d3 = record(base, '2026-09-03', 10, T.mid);
    const merged = mergeAppData(mergeAppData(d1, d2), d3);
    expect(findTask(merged, '2026-09-01')?.doneAmount).toBe(10);
    expect(findTask(merged, '2026-09-02')?.doneAmount).toBe(10);
    expect(findTask(merged, '2026-09-03')?.doneAmount).toBe(10);
  });

  it('タスクは日付順に並ぶ', () => {
    const merged = mergeAppData(a, b);
    const dates = merged.tasks.map((task) => task.date);
    expect(dates).toEqual([...dates].sort());
  });
});

/** localStorage の代わり。テスト環境には無いので用意する。 */
function stubStorage(stored: string | null): void {
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: () => {},
    removeItem: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('同期サーバーの URL', () => {
  it('固定されていて、末尾にスラッシュが付かない', () => {
    expect(SYNC_API_BASE).toMatch(/^https?:\/\//);
    expect(SYNC_API_BASE).not.toMatch(/\/$/);
  });
});

describe('同期設定の読み込み', () => {
  it('保存されたコードを読む', () => {
    stubStorage(JSON.stringify({ code: 'ABC-123', lastSyncedAt: '2026-09-01T00:00:00.000Z' }));
    expect(loadSyncSettings()).toEqual({
      code: 'ABC-123',
      lastSyncedAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('以前保存された URL は読み捨てる', () => {
    stubStorage(JSON.stringify({ apiBase: 'https://old.example.com', code: 'ABC-123' }));
    const settings = loadSyncSettings();
    expect(settings.code).toBe('ABC-123');
    expect(settings).not.toHaveProperty('apiBase');
  });

  it('何も保存されていなければ空で始める', () => {
    stubStorage(null);
    expect(loadSyncSettings()).toEqual({ code: '', lastSyncedAt: null });
  });

  it('壊れた値でも落ちない', () => {
    stubStorage('{ですけど');
    expect(loadSyncSettings()).toEqual({ code: '', lastSyncedAt: null });
  });

  it('型が違う値は既定に落とす', () => {
    stubStorage(JSON.stringify({ code: 42, lastSyncedAt: [] }));
    expect(loadSyncSettings()).toEqual({ code: '', lastSyncedAt: null });
  });
});

describe('同期の準備ができているか', () => {
  it('コードがあれば準備できている', () => {
    expect(isSyncConfigured({ code: 'ABC-123', lastSyncedAt: null })).toBe(true);
  });

  it('コードが無ければ同期しない', () => {
    expect(isSyncConfigured({ code: '', lastSyncedAt: null })).toBe(false);
  });
});
