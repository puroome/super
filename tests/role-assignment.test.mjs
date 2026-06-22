// tests/role-assignment.test.mjs — node tests/role-assignment.test.mjs 로 실행
import assert from 'node:assert';
import { assignRoles, extractRole } from '../js/algorithm.js';

// 슬롯 1개, 정감독 정원 1명. 그 중 1명은 "반드시들어가야하는시간"으로 이미 [1] 보직이 박혀 있고,
// 나머지 1명은 일반 배정(data===1) 대상. 정원이 1명뿐이므로 일반 배정 쪽은 보직을 못 받아야 한다.
{
  const slots = [{ dayIdx: 1, period: 1 }];
  const tCount = 2, sCount = 1;
  // data[1][1]: 반드시들어가야하는시간으로 사전에 보직까지 박힌 고정셀
  // data[2][1]: 그냥 배정만 된 일반 셀(보직 미정, 1)
  const data = [[], ['', '[1]'], ['', 1]];
  const fixedMap = [[], [true, true], [false, false]];
  const roles = [{ name: '정감독', workload: 100 }];
  const scheduleData = { 1: { 1: [0, 1] } }; // dayIdx1/period1/role1 정원 = 1명

  assignRoles(data, fixedMap, slots, [{ prevWorkload: 0 }, { prevWorkload: 0 }], scheduleData, roles, tCount, sCount);

  assert.strictEqual(extractRole(String(data[1][1])), 1, '사전 배정된 보직은 유지되어야 함');
  assert.strictEqual(extractRole(String(data[2][1])), 0, '정원이 이미 찼으므로 2번째 사람은 보직을 받으면 안 됨(미배정 버그 재발 방지)');
}

console.log('OK: assignRoles 사전배정 인원 차감 정상 동작');
