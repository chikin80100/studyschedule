import { describe, expect, it } from 'vitest';
import { emptyData, exportToJson, importFromJson, parseAppData } from './storage';
import { createDefaultWeekdaySettings } from './types';
import type { AppData, Plan, Task } from './types';
import { generateTasks } from './lib/taskGenerator';

const plan: Plan = {
  id: 'plan-1',
  title: '数学の問題集',
  unit: 'ページ',
  startDate: '2026-09-01',
  endDate: '2026-09-10',
  totalAmount: 100,
  weekdaySettings: createDefaultWeekdaySettings(),
  bufferRatio: 0.15,
  roundingStep: 'auto',
  createdAt: '2026-08-25T00:00:00.000Z',
};

function dataWith(plans: unknown[], tasks: unknown[] = []) {
  return { version: 1, plans, tasks };
}

describe('parseAppData', () => {
  it('正しいデータをそのまま復元する', () => {
    const tasks = generateTasks(plan);
    const result = parseAppData({ version: 1, plans: [plan], tasks });
    expect(result.data.plans).toHaveLength(1);
    expect(result.data.tasks).toHaveLength(tasks.length);
    expect(result.droppedPlanCount).toBe(0);
  });

  it('オブジェクトでない入力は空データにする', () => {
    for (const value of [null, 42, 'text', [1, 2, 3], undefined]) {
      expect(parseAppData(value).data).toEqual(emptyData());
    }
  });

  it('壊れたプランを捨てる', () => {
    const broken = [
      { ...plan, id: '' },
      { ...plan, startDate: 'not-a-date' },
      { ...plan, totalAmount: 0 },
      'plan',
      null,
    ];
    const result = parseAppData(dataWith(broken));
    expect(result.data.plans).toHaveLength(0);
    expect(result.droppedPlanCount).toBe(5);
  });

  it('読めてもタスクを生成できないプランを捨てる', () => {
    // 終了日が開始日より前 / 全曜日休養日 / 全曜日の量が 0
    const restAll = createDefaultWeekdaySettings().map((s) => ({ ...s, isRestDay: true }));
    const zeroAll = createDefaultWeekdaySettings().map((s) => ({ ...s, weight: 0 }));
    const result = parseAppData(
      dataWith([
        { ...plan, id: 'a', startDate: '2026-09-30', endDate: '2026-09-01' },
        { ...plan, id: 'b', weekdaySettings: restAll },
        { ...plan, id: 'c', weekdaySettings: zeroAll },
      ]),
    );
    expect(result.data.plans).toHaveLength(0);
  });

  it('復元したプランは必ずタスクを生成できる', () => {
    const result = parseAppData(dataWith([plan, { ...plan, id: 'x', bufferRatio: 99 }]));
    for (const restored of result.data.plans) {
      expect(() => generateTasks(restored)).not.toThrow();
    }
  });

  it('存在しないプランに紐づくタスクを捨てる', () => {
    const orphan: Task = {
      id: 't1',
      planId: 'missing',
      date: '2026-09-01',
      kind: 'study',
      plannedAmount: 10,
      doneAmount: 0,
      isCompleted: false,
    };
    expect(parseAppData(dataWith([plan], [orphan])).data.tasks).toHaveLength(0);
  });

  it('数値として読める文字列を受け入れる', () => {
    const result = parseAppData(dataWith([{ ...plan, totalAmount: '120' }]));
    expect(result.data.plans[0].totalAmount).toBe(120);
  });

  it('曜日設定が壊れていても既定値で補う', () => {
    const result = parseAppData(dataWith([{ ...plan, weekdaySettings: 'broken' }]));
    expect(result.data.plans[0].weekdaySettings).toHaveLength(7);
    expect(result.data.plans[0].weekdaySettings.map((s) => s.dayOfWeek)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('予備日は計画量と完了フラグを持たない', () => {
    const task: Task = {
      id: 't1',
      planId: 'plan-1',
      date: '2026-09-01',
      kind: 'buffer',
      plannedAmount: 10,
      doneAmount: 3,
      isCompleted: true,
    };
    const restored = parseAppData(dataWith([plan], [task])).data.tasks[0];
    expect(restored.plannedAmount).toBe(0);
    expect(restored.isCompleted).toBe(false);
    expect(restored.doneAmount).toBe(3);
  });
});

describe('importFromJson', () => {
  const data: AppData = { version: 1, plans: [plan], tasks: generateTasks(plan) };

  it('書き出したデータを読み戻せる', () => {
    const restored = importFromJson(exportToJson(data));
    expect(restored.plans).toHaveLength(1);
    expect(restored.tasks).toHaveLength(data.tasks.length);
  });

  it('プランが空のデータも読める', () => {
    expect(importFromJson(JSON.stringify(emptyData())).plans).toHaveLength(0);
  });

  it('このアプリのデータでない JSON を弾く', () => {
    for (const json of [
      '{"version":1,"plns":[],"tasks":[]}',
      '{"foo":"bar","items":[1,2,3]}',
      '{"plans":{"a":1},"tasks":[]}',
      '[1,2,3]',
      '42',
      'null',
      '"text"',
    ]) {
      expect(() => importFromJson(json)).toThrow();
    }
  });

  it('プランが1件も読めない場合は弾く', () => {
    const json = JSON.stringify(dataWith([{ ...plan, startDate: 'x' }]));
    expect(() => importFromJson(json)).toThrow(/読み込めませんでした/);
  });

  it('JSON として壊れていれば例外になる', () => {
    expect(() => importFromJson('{')).toThrow();
  });
});
