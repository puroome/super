// tests/room-requirements-prune.test.mjs — node tests/room-requirements-prune.test.mjs 로 실행
import assert from 'node:assert';
import { pruneRoomRequirements, aggregateRoomRequirements } from '../js/algorithm.js';

const roomRequirements = [
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '202', count: 2 },
  { dayIdx: 1, period: 1, roleIdx: 1, roomName: '305', count: 1 },
  { dayIdx: 1, period: 2, roleIdx: 2, roomName: '202', count: 3 },
];

// 고사실명을 "202" → "305호"로 바꿨다고 가정 (305는 그대로 유지)
{
  const pruned = pruneRoomRequirements(roomRequirements, ['305', '305호']);
  // 더이상 없는 "202" 관련 항목은 사라지고 "305"만 남아야 함
  assert.deepStrictEqual(pruned, [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '305', count: 1 },
  ]);
}

// 고사실을 모두 삭제하면 배정감독수 설정도 전부 사라져야 함
{
  assert.deepStrictEqual(pruneRoomRequirements(roomRequirements, []), []);
}

// aggregateRoomRequirements: 같은 날짜/교시/보직이면 고사실이 달라도 합산
{
  const agg = aggregateRoomRequirements(roomRequirements);
  assert.deepStrictEqual(agg, [
    { dayIdx: 1, period: 1, roleIdx: 1, count: 3 }, // 202(2) + 305(1)
    { dayIdx: 1, period: 2, roleIdx: 2, count: 3 },
  ]);
}

console.log('OK: pruneRoomRequirements/aggregateRoomRequirements 정상 동작 (고사실명 변경 시 고아데이터 정리)');
