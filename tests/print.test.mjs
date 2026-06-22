// tests/print.test.mjs — node tests/print.test.mjs 로 실행
import assert from 'node:assert';
import { buildFullTableHTML, buildPersonalTableHTML } from '../js/print.js';

const examDays = [{ date: '2026-04-27', startPeriod: 1, endPeriod: 2 }];
const roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50 }];
const rooms = ['101'];
const teachers = [{ name: '홍길동' }, { name: '김철수' }];
// slots: dayIdx1/period1 = j1, dayIdx1/period2 = j2
const slots = [{ dayIdx: 1, period: 1 }, { dayIdx: 1, period: 2 }];
// data[1] = 홍길동(1교시 101실 정감독), data[2] = 김철수(2교시 미배정으로 0)
const data = [[], ['', '101[1]', 0], ['', 0, 0]];

// ── 전체 감독표: 보직명 축약 + 날짜/교시 rowspan ──
{
  const html = buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays });
  assert.ok(html.includes('>정<'), '정감독은 "정"으로 축약되어야 함');
  assert.ok(html.includes('>부<'), '부감독은 "부"으로 축약되어야 함');
  // 날짜 칸은 (교시2개 × 보직2개)=4행을 한 번에 묶어야 함
  assert.ok(html.includes('rowspan="4"'), '날짜 칸은 해당 일자의 전체 행을 rowspan으로 묶어야 함');
  // 교시 칸은 보직 수(2)만큼만 묶어야 함
  assert.ok(html.includes('rowspan="2"'), '교시 칸은 보직 수만큼 rowspan으로 묶어야 함');
}

// ── 개인 시간표: 미배정 칸(roleIdx=0)은 비어있어야 하고, 배정된 칸은 고사실명만 보여야 함 ──
{
  const html = buildPersonalTableHTML({ data, slots, teacher: teachers[0], teacherIdx: 1, roles, examDays });
  assert.ok(html.includes('<td>101</td>'), '배정된 고사실은 보직 표시 없이 그냥 "101"로만 나와야 함');
  assert.ok(!html.includes('[1]'), '고사장 칸에 [보직] 표기가 남아있으면 안 됨');
  assert.ok(html.includes('<td>2교시</td><td></td><td></td>'), '미배정(roleIdx=0) 칸은 고사장·보직 모두 비어있어야 함');
}

console.log('OK: print.js rowspan 병합 / 보직명 축약 / 미배정 숨김 정상 동작');
