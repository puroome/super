// tests/save-snapshot.test.mjs — node tests/save-snapshot.test.mjs 로 실행
import assert from 'node:assert';
import { buildSaveSnapshot, applySnapshotToState, emptyState } from '../js/algorithm.js';

{
  const state = {
    teachers: [{ name: '홍길동', quota: 3 }],
    rooms: ['101'],
    roles: [{ name: '정감독', workload: 100 }],
    examDays: [{ date: '2026-04-27', startPeriod: 1, endPeriod: 1 }],
    requirements: [{ dayIdx: 1, period: 1, roleIdx: 1, count: 1 }],
    roomRequirements: [{ dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 1 }],
    data: [[], ['', '101[1]']],
    fixedCells: { 1: { 1: true } },
    workload: [0, 100],
    roleCounts: [{ teacherIdx: 1, counts: [0, 1] }],
    slots: [{ dayIdx: 1, period: 1 }],
  };

  const snapshot = buildSaveSnapshot(state);
  assert.ok(snapshot.assignment, '배정 결과가 있으면 assignment가 채워져야 함');

  const restored = applySnapshotToState(snapshot);
  assert.deepStrictEqual(restored.teachers, state.teachers);
  assert.deepStrictEqual(restored.data, state.data);
  assert.deepStrictEqual(restored.fixedCells, state.fixedCells);
}

{
  const state = {
    teachers: [], rooms: [], roles: [], examDays: [],
    requirements: [], roomRequirements: [],
    data: null, fixedCells: {}, workload: [], roleCounts: [], slots: [],
  };
  const snapshot = buildSaveSnapshot(state);
  assert.strictEqual(snapshot.assignment, null);

  const restored = applySnapshotToState(snapshot);
  assert.strictEqual(restored.data, null);
  assert.deepStrictEqual(restored.fixedCells, {});
}

{
  const e = emptyState();
  assert.deepStrictEqual(e.teachers, []);
  assert.strictEqual(e.data, null);
  assert.deepStrictEqual(e.fixedCells, {});
}

console.log('OK: save-snapshot 왕복 변환 및 초기화 상태 정상 동작');
