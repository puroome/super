// tests/slot-format.test.mjs — node tests/slot-format.test.mjs 로 실행
import assert from 'node:assert';
import { normalizeSlotStr, parseUnavailableSlots, parseRequiredSlots, buildSlots } from '../js/algorithm.js';

// normalizeSlotStr: 표준 출력은 붙여쓰기(nm). 예전 하이픈/언더스코어 입력도 호환.
{
  assert.strictEqual(normalizeSlotStr('1-1, 2-3'), '11, 23');
  assert.strictEqual(normalizeSlotStr('1_1, 2_3'), '11, 23');
  assert.strictEqual(normalizeSlotStr('11,21,3'), '11, 21, 3');
  assert.strictEqual(normalizeSlotStr('11, 21, 3'), '11, 21, 3');
  assert.strictEqual(normalizeSlotStr(''), '');
}

const examDays = [
  { date: '2026-04-27', startPeriod: 1, endPeriod: 3 },
  { date: '2026-04-28', startPeriod: 1, endPeriod: 3 },
  { date: '2026-04-29', startPeriod: 1, endPeriod: 3 },
  { date: '2026-04-30', startPeriod: 1, endPeriod: 3 },
];
const slots = buildSlots(examDays); // 1일차 1~3교시(슬롯1~3), 2일차 1~3교시(슬롯4~6) ...

// parseUnavailableSlots: 12 = 1일차 2교시, 한 자리 숫자 = 해당 일차 전체 제외
{
  assert.deepStrictEqual(parseUnavailableSlots('11, 23', slots), [1, 6]);
  assert.deepStrictEqual(parseUnavailableSlots('11,23', slots), [1, 6]);
  assert.deepStrictEqual(parseUnavailableSlots('1, 22, 4', slots), [1, 2, 3, 5, 10, 11, 12]);
  assert.deepStrictEqual(parseUnavailableSlots('1_1', slots), [1]); // 예전 형식 호환
  assert.deepStrictEqual(parseUnavailableSlots('', slots), []);
}

// parseRequiredSlots: 고정시간은 붙여쓰기(nm), 감독유형은 순서대로 매칭
{
  assert.deepStrictEqual(
    parseRequiredSlots('12, 21', '1, 2', slots),
    [{ slotIdx: 2, roleIdx: 1 }, { slotIdx: 4, roleIdx: 2 }]
  );
  assert.deepStrictEqual(parseRequiredSlots('1_2, 2_1', '1, 2', slots), [
    { slotIdx: 2, roleIdx: 1 }, { slotIdx: 4, roleIdx: 2 },
  ]);
  assert.deepStrictEqual(parseRequiredSlots('', '', slots), []);
}

console.log('OK: slot-format(붙여쓰기 표준)/parseRequiredSlots 정상 동작');
