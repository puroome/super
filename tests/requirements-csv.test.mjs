// tests/requirements-csv.test.mjs — node tests/requirements-csv.test.mjs 로 실행
import assert from 'node:assert';
import { parseRequirementsCSV } from '../js/algorithm.js';

const examDays = [{ date: '2026-04-27', startPeriod: 1, endPeriod: 2 }];
const roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50 }];

// 정상 케이스: 헤더 + 행 1개, 고사실 2칸
{
  const csv = '날짜,교시,보직,101,102\n2026-04-27,1,정감독,2,1';
  const { roomRequirements, errors } = parseRequirementsCSV(csv, examDays, roles);
  assert.strictEqual(errors.length, 0);
  assert.deepStrictEqual(roomRequirements, [
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '101', count: 2 },
    { dayIdx: 1, period: 1, roleIdx: 1, roomName: '102', count: 1 },
  ]);
}

// 존재하지 않는 날짜/보직 → 에러로 수집되고 해당 행은 무시됨
{
  const csv = '날짜,교시,보직,101\n2099-01-01,1,정감독,3\n2026-04-27,1,없는보직,1';
  const { roomRequirements, errors } = parseRequirementsCSV(csv, examDays, roles);
  assert.strictEqual(roomRequirements.length, 0);
  assert.strictEqual(errors.length, 2);
}

console.log('OK: requirements-csv parse 정상 동작');
