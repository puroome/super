// tests/tab-locks.test.mjs — node tests/tab-locks.test.mjs 로 실행
import assert from 'node:assert';
import { computeTabLocks, emptyState } from '../js/algorithm.js';

// 빈 상태: 배정설정·자동배정·감독표 모두 잠김
{
  const locks = computeTabLocks(emptyState());
  assert.strictEqual(locks['tab-req'], true);
  assert.strictEqual(locks['tab-assign'], true);
  assert.strictEqual(locks['tab-table'], true);
}

// 기본정보(교사·고사실·시험일)만 채움 → 배정설정만 열림
{
  const state = {
    ...emptyState(),
    teachers: [{ name: '홍길동' }],
    rooms: ['101'],
    examDays: [{ date: '2026-04-27', startPeriod: 1, endPeriod: 3 }],
  };
  const locks = computeTabLocks(state);
  assert.strictEqual(locks['tab-req'], false);
  assert.strictEqual(locks['tab-assign'], true);
  assert.strictEqual(locks['tab-table'], true);
}

// + 배정설정(고사실별 필요인원)까지 채움 → 자동배정도 열림 (단, 감독표는 아직 잠김)
{
  const state = {
    ...emptyState(),
    teachers: [{ name: '홍길동' }],
    rooms: ['101'],
    examDays: [{ date: '2026-04-27', startPeriod: 1, endPeriod: 3 }],
    roomRequirements: [{ dayIdx: 0, period: 1, roleIdx: 0, roomName: '101', count: 1 }],
  };
  const locks = computeTabLocks(state);
  assert.strictEqual(locks['tab-assign'], false);
  assert.strictEqual(locks['tab-table'], true);
}

// + 자동배정 실행 완료(state.data 존재) → 감독표도 열림
{
  const state = {
    ...emptyState(),
    teachers: [{ name: '홍길동' }],
    rooms: ['101'],
    examDays: [{ date: '2026-04-27', startPeriod: 1, endPeriod: 3 }],
    roomRequirements: [{ dayIdx: 0, period: 1, roleIdx: 0, roomName: '101', count: 1 }],
    data: [['정']],
  };
  const locks = computeTabLocks(state);
  assert.strictEqual(locks['tab-table'], false);
}

console.log('tab-locks: 전부 통과');
