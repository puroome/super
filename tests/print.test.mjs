// tests/print.test.mjs — node tests/print.test.mjs 로 실행
import assert from 'node:assert';
import { buildFullTableHTML, buildPersonalTableHTML } from '../js/print.js';

const examDays = [{ date: '2026-04-27', startPeriod: 1, endPeriod: 2 }];
const roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50 }];
const rooms = ['101'];
const teachers = [{ name: '홍길동(순회)' }, { name: '김철수' }];
const slots = [{ dayIdx: 1, period: 1 }, { dayIdx: 1, period: 2 }];
const data = [[], ['', '101[1]', 0], ['', 0, 0]];

// ── 전체 감독표: 괄호 제거 + 보직명 축약 + rowspan ──
{
  const html = buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays });
  assert.ok(html.includes('>정<'), '정감독은 "정"으로 축약되어야 함');
  assert.ok(html.includes('>부<'), '부감독은 "부"으로 축약되어야 함');
  assert.ok(html.includes('rowspan="4"'), '날짜 칸은 해당 일자의 전체 행을 rowspan으로 묶어야 함');
  assert.ok(html.includes('rowspan="2"'), '교시 칸은 보직 수만큼 rowspan으로 묶어야 함');
  assert.ok(!html.includes('(순회)'), '인쇄물에서 괄호 정보는 제거되어야 함');
  assert.ok(html.includes('홍길동'), '괄호 제거 후 이름은 남아있어야 함');
  assert.ok(html.includes('rgba(0,0,0,0.3)'), '헤더 배경은 rgba(0,0,0,0.3)이어야 함');
}

// ── 개인 시간표: 괄호 제거 + 짝수날 배경 + 미배정 숨김 ──
{
  // 짝수날 테스트를 위해 examDays 2일로 확장
  const twodays = [
    { date: '2026-04-27', startPeriod: 1, endPeriod: 1 },
    { date: '2026-04-28', startPeriod: 1, endPeriod: 1 },
  ];
  const twoSlots = [{ dayIdx: 1, period: 1 }, { dayIdx: 2, period: 1 }];
  const twoData = [[], ['', '101[1]', '102[1]']];
  const html = buildPersonalTableHTML({ data: twoData, slots: twoSlots, teacher: teachers[0], teacherIdx: 1, roles, examDays: twodays });
  assert.ok(!html.includes('(순회)'), '개인표에서도 괄호는 제거되어야 함');
  assert.ok(html.includes('rgba(0,0,0,0.15)'), '짝수 번째 날짜 행은 옅은 회색 배경이어야 함');
}

// ── 개인 시간표: 미배정 칸은 비어있어야 함 ──
{
  const html = buildPersonalTableHTML({ data, slots, teacher: teachers[0], teacherIdx: 1, roles, examDays });
  assert.ok(html.includes('<td>101</td>'), '배정된 고사실은 "101"로만 나와야 함');
  assert.ok(!html.includes('[1]'), '고사장 칸에 [보직] 표기가 남아있으면 안 됨');
}

console.log('OK: print.js 괄호제거 / 헤더색상 / rowspan / 짝수날배경 / 미배정숨김 정상 동작');
