import { describe, expect, it } from 'vitest';
import { buildReminderText, decodeVapidKey } from './notify';
import { generateTasks } from './taskGenerator';
import { createDefaultWeekdaySettings } from '../types';
import type { Plan, Task } from '../types';

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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const complete = (tasks: Task[], date: string): Task[] =>
  tasks.map((task) =>
    task.date === date
      ? { ...task, doneAmount: task.plannedAmount, isCompleted: true }
      : task,
  );

describe('buildReminderText', () => {
  it('今日の残りを本文に出す', () => {
    const plan = makePlan();
    const text = buildReminderText([plan], generateTasks(plan), '2026-09-01');
    expect(text.title).toBe('勉強の時間です');
    expect(text.body).toBe('英単語 10語');
  });

  it('やった分を差し引いた残りを出す', () => {
    const plan = makePlan();
    const tasks = generateTasks(plan).map((task) =>
      task.date === '2026-09-01' ? { ...task, doneAmount: 4 } : task,
    );
    expect(buildReminderText([plan], tasks, '2026-09-01').body).toBe('英単語 6語');
  });

  it('複数のプランを並べる', () => {
    const a = makePlan();
    const b = makePlan({ id: 'plan-2', title: '漢字', unit: '問', totalAmount: 25 });
    const tasks = [...generateTasks(a), ...generateTasks(b)];
    expect(buildReminderText([a, b], tasks, '2026-09-01').body).toBe('英単語 10語 / 漢字 5問');
  });

  it('多すぎるときは3件までにして「ほか」を付ける', () => {
    const plans = [1, 2, 3, 4].map((n) =>
      makePlan({ id: `plan-${n}`, title: `教材${n}`, totalAmount: 25 }),
    );
    const tasks = plans.flatMap((plan) => generateTasks(plan));
    const body = buildReminderText(plans, tasks, '2026-09-01').body;
    expect(body).toBe('教材1 5語 / 教材2 5語 / 教材3 5語 ほか');
  });

  it('今日の分が終わっていればねぎらう', () => {
    const plan = makePlan();
    const tasks = complete(generateTasks(plan), '2026-09-01');
    const text = buildReminderText([plan], tasks, '2026-09-01');
    expect(text.title).toBe('お疲れさまでした');
    expect(text.body).toContain('すべて終わって');
  });

  it('予定が無い日は休むよう伝える', () => {
    const plan = makePlan();
    const text = buildReminderText([plan], generateTasks(plan), '2026-12-31');
    expect(text.body).toContain('予定がありません');
  });

  it('休養日は予定なし扱いにする', () => {
    // 2026-09-01 は火曜。火曜を休養日にする。
    const restTuesday = makePlan({
      weekdaySettings: createDefaultWeekdaySettings().map((setting) =>
        setting.dayOfWeek === 2 ? { ...setting, isRestDay: true } : setting,
      ),
    });
    const text = buildReminderText([restTuesday], generateTasks(restTuesday), '2026-09-01');
    expect(text.body).toContain('予定がありません');
  });

  it('プランが1件も無くても落ちない', () => {
    expect(buildReminderText([], [], '2026-09-01').body).toContain('予定がありません');
  });

  it('タスクだけあってプランが消えている場合も落ちない', () => {
    const plan = makePlan();
    const text = buildReminderText([], generateTasks(plan), '2026-09-01');
    expect(text.title).toBeTruthy();
  });
});

describe('decodeVapidKey', () => {
  it('base64url を元のバイト列に戻す', () => {
    // 先頭が 0x04 の 65 バイト (非圧縮の P-256 公開鍵と同じ形)
    const original = new Uint8Array(65);
    original[0] = 0x04;
    for (let i = 1; i < 65; i += 1) original[i] = i;

    let binary = '';
    for (const byte of original) binary += String.fromCharCode(byte);
    const base64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    expect(decodeVapidKey(base64Url)).toEqual(original);
  });
});
