// tests/room-requirements-prune.test.mjs — node tests/room-requirements-prune.test.mjs 로 실행
import assert from 'node:assert';
import { pruneRoomRequirements, aggregateRoomRequirements, removeRoleFromRequirements, removeDayFromRequirements } from '../js/algorithm.js';

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

// removeRoleFromRequirements: 삭제된 보직(roleIdx) 관련 항목은 버리고, 뒤 보직들은 한 칸씩 당김
{
  const reqs = [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 2 }, // 1번 보직(삭제 대상)
    { dayIdx: 1, period: 1, roleIdx: 2, roomName: '101', count: 3 }, // 2번 보직 → 1번으로 당겨짐
    { dayIdx: 1, period: 1, roleIdx: 3, roomName: '101', count: 1 }, // 3번 보직 → 2번으로 당겨짐
  ];
  assert.deepStrictEqual(removeRoleFromRequirements(reqs, 1), [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 3 },
    { dayIdx: 1, period: 1, roleIdx: 2, roomName: '101', count: 1 },
  ]);
}

// removeDayFromRequirements: 삭제된 날짜(dayIdx) 관련 항목은 버리고, 뒤 날짜들은 한 칸씩 당김
{
  const reqs = [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 2 }, // 1일차(삭제 대상)
    { dayIdx: 2, period: 1, roleIdx: 1, roomName: '101', count: 3 }, // 2일차 → 1일차로 당겨짐
  ];
  assert.deepStrictEqual(removeDayFromRequirements(reqs, 1), [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 3 },
  ]);
}

console.log('OK: removeRoleFromRequirements/removeDayFromRequirements 정상 동작 (보직/날짜 삭제 시 인덱스 보정)');
