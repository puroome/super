// tests/print.test.mjs — node tests/print.test.mjs 로 실행
import assert from 'node:assert';
import { buildFullTableHTML, buildPersonalTableHTML } from '../js/print.js';

const examDays = [{ date: '2026-04-27', startPeriod: 1, endPeriod: 2 }];
const roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50 }];
const rooms = ['101'];
const teachers = [{ name: '홍길동(순회)' }, { name: '김철수' }];
const slots = [{ dayIdx: 1, period: 1 }, { dayIdx: 1, period: 2 }];
const data = [[], ['', '101[1]', 0], ['', 0, 0]];

// ── 전체 감독표 ──
{
  const html = buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays });
  assert.ok(html.includes('>정<'), '정감독은 "정"으로 축약되어야 함');
  assert.ok(html.includes('>부<'), '부감독은 "부"으로 축약되어야 함');
  // 날짜열 제거: <th>날짜</th>가 없어야 함
  assert.ok(!html.includes('<th>날짜</th>') && !html.includes('>날짜<'), '날짜 열은 표에서 제거되어야 함');
  // 날짜가 제목으로 나와야 함
  assert.ok(html.includes('4/27') && html.includes('감독 배정표'), '날짜는 표 위 제목으로 나와야 함');
  // 날짜열 없으므로 rowspan은 roleCount(2)만큼
  assert.ok(html.includes('rowspan="2"'), '교시 칸은 보직 수만큼 rowspan으로 묶어야 함');
  // 헤더 배경색 확인 (폰트는 검정)
  assert.ok(html.includes('rgba(0,0,0,0.3)'), '헤더 배경은 rgba(0,0,0,0.3)이어야 함');
  assert.ok(html.includes('color:#000'), '헤더 폰트는 검정(#000)이어야 함');
  // 괄호 제거
  assert.ok(!html.includes('(순회)'), '인쇄물에서 괄호 정보는 제거되어야 함');
  // h-text 클래스로 교시/보직/합계는 가로쓰기
  assert.ok(html.includes('class="h-text"'), '교시·보직·합계 헤더는 h-text 클래스여야 함');
}

// ── 개인 시간표 ──
{
  const twodays = [
    { date: '2026-04-27', startPeriod: 1, endPeriod: 1 },
    { date: '2026-04-28', startPeriod: 1, endPeriod: 1 },
  ];
  const twoSlots = [{ dayIdx: 1, period: 1 }, { dayIdx: 2, period: 1 }];
  const twoData = [[], ['', '101[1]', '102[1]']];
  const html = buildPersonalTableHTML({ data: twoData, slots: twoSlots, teacher: teachers[0], teacherIdx: 1, roles, examDays: twodays });
  // 짝수 날짜(두 번째 날)는 rgba(0,0,0,0.15) 배경
  assert.ok(html.includes('rgba(0,0,0,0.15)'), '짝수 번째 날짜의 모든 td에 옅은 회색 배경이어야 함');
  // 헤더 배경 + 검정 폰트
  assert.ok(html.includes('rgba(0,0,0,0.3)'), '헤더 배경은 rgba(0,0,0,0.3)이어야 함');
  assert.ok(html.includes('color:#000'), '헤더 폰트는 검정(#000)이어야 함');
  // 괄호 제거
  assert.ok(!html.includes('(순회)'), '개인표에서도 괄호는 제거되어야 함');
}

// ── 개인 시간표: 미배정 칸은 비어있어야 함 ──
{
  const html = buildPersonalTableHTML({ data, slots, teacher: teachers[0], teacherIdx: 1, roles, examDays });
  assert.ok(html.includes('<td'), '테이블 데이터 셀이 있어야 함');
  assert.ok(!html.includes('[1]'), '고사장 칸에 [보직] 표기가 남아있으면 안 됨');
}

console.log('OK: print.js 날짜열제거/제목/헤더검정/짝수날배경/괄호제거/h-text 정상 동작');
