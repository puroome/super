// tests/slot-format.test.mjs — node tests/slot-format.test.mjs 로 실행
import assert from 'node:assert';
import { normalizeSlotStr, parseUnavailableSlots, parseRequiredSlots, buildSlots } from '../js/algorithm.js';

// normalizeSlotStr: 표준 출력은 언더스코어(_). 옛 하이픈(-) 입력도 호환.
{
  assert.strictEqual(normalizeSlotStr('1-1, 2-3'), '1_1, 2_3');
  assert.strictEqual(normalizeSlotStr('1_1, 2_3'), '1_1, 2_3');
  assert.strictEqual(normalizeSlotStr(''), '');
  // 날짜로 깨져버린 값(예: 46023)처럼 형식이 안 맞으면 그대로 둬서 사용자가 보고 고치게 함
  assert.strictEqual(normalizeSlotStr('46023'), '46023');
}

const examDays = [
  { date: '2026-04-27', startPeriod: 1, endPeriod: 3 },
  { date: '2026-04-28', startPeriod: 1, endPeriod: 3 },
];
const slots = buildSlots(examDays); // 1일차 1~3교시(슬롯1~3), 2일차 1~3교시(슬롯4~6)

// parseUnavailableSlots: "일차_교시" → 슬롯 인덱스
{
  assert.deepStrictEqual(parseUnavailableSlots('1_1, 2_3', slots), [1, 6]);
  assert.deepStrictEqual(parseUnavailableSlots('1-1', slots), [1]); // 옛 하이픈 호환
  assert.deepStrictEqual(parseUnavailableSlots('', slots), []);
}

// parseRequiredSlots: 고정시간 슬롯과 감독유형(역할번호)을 함께 반환 — 자동배정 탭 파란색 표시에 쓰임
{
  assert.deepStrictEqual(
    parseRequiredSlots('1_2, 2_1', '1, 2', slots),
    [{ slotIdx: 2, roleIdx: 1 }, { slotIdx: 4, roleIdx: 2 }]
  );
  assert.deepStrictEqual(parseRequiredSlots('', '', slots), []);
}

console.log('OK: slot-format(언더스코어 표준)/parseRequiredSlots 정상 동작');
