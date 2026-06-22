// tests/role-assignment.test.mjs — node tests/role-assignment.test.mjs 로 실행
import assert from 'node:assert';
import { assignRoles, extractRole } from '../js/algorithm.js';

{
  const slots = [{ dayIdx: 1, period: 1 }];
  const tCount = 2, sCount = 1;
  const data = [[], ['', '[1]'], ['', 1]];
  const fixedMap = [[], [true, true], [false, false]];
  const roles = [{ name: '정감독', workload: 100 }];
  const scheduleData = { 1: { 1: [0, 1] } };

  assignRoles(data, fixedMap, slots, [{ prevWorkload: 0 }, { prevWorkload: 0 }], scheduleData, roles, tCount, sCount);

  assert.strictEqual(extractRole(String(data[1][1])), 1, '사전 배정된 보직은 유지되어야 함');
  assert.strictEqual(extractRole(String(data[2][1])), 0, '정원이 이미 찼으므로 2번째 사람은 보직을 받으면 안 됨');
}

console.log('OK: assignRoles 사전배정 인원 차감 정상 동작');
