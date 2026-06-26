// tests/uncovered-rooms.test.mjs — node tests/uncovered-rooms.test.mjs 로 실행
// 감독이 배정되지 않은 고사실을 제대로 찾아내는지 검증한다.
import assert from 'node:assert';
import { assignAll, findUncoveredRooms, aggregateRoomRequirements } from '../js/algorithm.js';

const slots = [{ dayIdx: 1, period: 1 }]; // 슬롯 1개 (slotIdx 1)
const roomReq = [
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 1 },
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '102', count: 1 },
  { dayIdx: 1, period: 1, roleIdx: 2, roomName: '복도', count: 1 },
];

// ── 직접 검사 ──
// data[i][j]: i=교사(1-base), j=슬롯(1-base). 0번 행/열은 사용 안 함.
{
  // 복도가 비어있는 경우 (교사 2명이 101,102만 채움)
  const data = [['', ''], ['', '101[1]'], ['', '102[1]']];
  const u = findUncoveredRooms(data, roomReq, slots);
  assert.strictEqual(u.length, 1);
  assert.strictEqual(u[0].roomName, '복도');
}
{
  // 모든 방이 채워진 경우 → 빈 고사실 없음
  const data = [['', ''], ['', '101[1]'], ['', '102[1]'], ['', '복도[2]']];
  assert.strictEqual(findUncoveredRooms(data, roomReq, slots).length, 0);
}
{
  // '미배정[1]'은 방을 채운 것으로 치지 않는다
  const data = [['', ''], ['', '101[1]'], ['', '102[1]'], ['', '미배정[2]']];
  const u = findUncoveredRooms(data, roomReq, slots);
  assert.strictEqual(u.length, 1);
  assert.strictEqual(u[0].roomName, '복도');
}

// ── 실제 배정(assignAll)으로 끝까지 검증 ──
const examDays = [{ date: 'D1', startPeriod: 1, endPeriod: 1 }];
const roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50, active: true }];
const roomReqE = [
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 1 },
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '102', count: 1 },
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '103', count: 1 },
  { dayIdx: 1, period: 1, roleIdx: 2, roomName: '복도', count: 1 },
];
const requirements = aggregateRoomRequirements(roomReqE);
const mk = (...names) => names.map(n => ({ name: n, prevWorkload: 0, forbiddenRooms: '', unavailableSlots: [], requiredSlots: [] }));

{
  // 교사 부족 (3명 / 자리 4) → 1곳은 감독 없이 비어야 한다
  const r = assignAll({ teachers: mk('가', '나', '다'), examDays, roles, requirements, roomRequirements: roomReqE, fixedCells: {} });
  assert.strictEqual(findUncoveredRooms(r.data, roomReqE, r.slots).length, 1);
}
{
  // 교사 충분 (5명 / 자리 4) → 빈 고사실 없음
  const r = assignAll({ teachers: mk('가', '나', '다', '라', '마'), examDays, roles, requirements, roomRequirements: roomReqE, fixedCells: {} });
  assert.strictEqual(findUncoveredRooms(r.data, roomReqE, r.slots).length, 0);
}

console.log('OK: findUncoveredRooms 정상 동작');
