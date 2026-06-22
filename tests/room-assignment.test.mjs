// tests/room-assignment.test.mjs — node tests/room-assignment.test.mjs 로 실행
import assert from 'node:assert';
import { assignRooms, extractRoom, extractRole, parseRequirementsCSV } from '../js/algorithm.js';

// ── 1. 고사실 칸(1개)보다 배정인원(2명)이 많을 때, 같은 방에 중복 배정되면 안 된다 ──
{
  const slots = [{ dayIdx: 1, period: 1 }];
  const tCount = 2, sCount = 1;
  const data = [[], ['', '[1]'], ['', '[1]']]; // 1-based: data[1][1], data[2][1] 둘 다 정감독(1) 배정됨
  const fixedMap = [[], [false, false], [false, false]];
  const roles = [{ name: '정감독', workload: 100 }];
  const roomRequirements = [{ dayIdx: 1, period: 1, roleIdx: 1, roomName: '205', count: 1 }]; // 정원 1명뿐

  const shortages = assignRooms(data, fixedMap, slots, [], null, roles, roomRequirements, tCount, sCount);

  const rooms = [extractRoom(String(data[1][1])), extractRoom(String(data[2][1]))];
  // 둘 다 "205"가 되면 안 됨 — 한 명은 방을 받고 한 명은 미배정이어야 함
  assert.notStrictEqual(rooms[0] === '205' && rooms[1] === '205', true, '같은 방에 중복 배정되면 안 됨');
  assert.strictEqual(rooms.filter(r => r === '205').length, 1, '205실은 정확히 한 명만 받아야 함');
  assert.strictEqual(shortages.length, 1, '정원 초과분은 shortage로 기록되어야 함');
}

// ── 2. CSV에 같은 날짜/교시/보직/고사실 행이 중복으로 있으면 합산되어야 함 ──
{
  const examDays = [{ date: '2026-04-27', startPeriod: 1, endPeriod: 1 }];
  const roles = [{ name: '정감독', workload: 100 }];
  const csv = '날짜,교시,보직,205\n2026-04-27,1,정감독,1\n2026-04-27,1,정감독,1'; // 중복 행
  const { roomRequirements } = parseRequirementsCSV(csv, examDays, roles);
  assert.strictEqual(roomRequirements.length, 1, '중복 행은 합쳐져 1건이어야 함');
  assert.strictEqual(roomRequirements[0].count, 2, '카운트는 1+1=2로 합산되어야 함');
}

console.log('OK: room-assignment 중복배정 방지 및 CSV 중복합산 정상 동작');
