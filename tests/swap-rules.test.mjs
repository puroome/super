// tests/swap-rules.test.mjs — node tests/swap-rules.test.mjs 로 실행
// 수동 교환 규칙을 판정하는 classifySwap + 다른교시 당번맞바꾸기 crossTimeSwap 검증.
import assert from 'node:assert';
import { classifySwap, crossTimeSwap } from '../js/algorithm.js';

const teachers = [
  { name: '김', forbiddenRooms: '101' }, // i=1: 101호 제외
  { name: '이', forbiddenRooms: '' },    // i=2
  { name: '박', forbiddenRooms: '' },    // i=3
];

// 다른 교시 검사에 쓰는 보조정보(열 키). 1열=1_1, 2열=1_2, 3열=1_3
const maps = { slotKeys: ['1_1', '1_2', '1_3'] };

// ─── 같은 교시 ────────────────────────────────────────────────────────────────
// 같은 교시·같은 유형 (김 정 ↔ 이 정) → 바로 허용
{
  const data = [['', ''], ['', '102[1]'], ['', '103[1]']];
  assert.deepStrictEqual(classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 1 }), { ok: true });
}

// 같은 교시·다른 유형 (김 정 ↔ 박 부) → 유형 확인
{
  const data = [['', ''], ['', '102[1]'], ['', '103[1]'], ['', '복도[2]']];
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 3, j: 1 });
  assert.strictEqual(v.reason, 'role-confirm');
  assert.strictEqual(v.role1, 1);
  assert.strictEqual(v.role2, 2);
  assert.ok(!v.crossTime);
}

// 같은 교시·제외 고사실 (김을 101로) → 차단
{
  const data = [['', ''], ['', '102[1]'], ['', '101[1]']]; // 김=102, 이=101
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 1 });
  assert.strictEqual(v.reason, 'room');
  assert.strictEqual(v.forbidden[0].i, 1);
  assert.strictEqual(v.forbidden[0].room, '101');
}

// 같은 교시·둘 다 빈칸 → 의미 없음(noop)
{
  const data = [['', ''], ['', ''], ['', '']];
  assert.deepStrictEqual(classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 1 }), { reason: 'noop' });
}

// 같은 교시·한쪽 빈칸 → 넘겨주기 확인(transfer-confirm)
{
  const data = [['', ''], ['', ''], ['', '103[1]']]; // 김=빈칸, 이=103(정)
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 1 });
  assert.strictEqual(v.reason, 'transfer-confirm');
  assert.deepStrictEqual(v.from, { i: 2, j: 1 }); // 감독 가진 사람(이)
  assert.deepStrictEqual(v.to, { i: 1, j: 1 });   // 받는 사람(김, 빈칸)
  assert.strictEqual(v.role, 1);
}

// 같은 교시·한쪽 빈칸이지만 받는 사람이 제외 고사실 → 넘겨주기보다 제외 차단이 먼저
{
  const data = [['', ''], ['', ''], ['', '101[1]']]; // 김=빈칸, 이=101 → 김이 101 받게 됨
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 1 });
  assert.strictEqual(v.reason, 'room');
  assert.strictEqual(v.forbidden[0].i, 1);
}

// ─── 다른 교시(당번 맞바꾸기) ─────────────────────────────────────────────────
// 둘 다 감독 + 받을 자리 비어있음 + 같은 유형 → 바로 당번 맞바꾸기
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '203[1]']]; // 김=1열206, 이=2열203
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.deepStrictEqual(v, { ok: true, crossTime: true });
}

// 다른 교시 + 둘 다 감독 + 다른 유형 → 유형 확인(crossTime)
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '복도[2]']];
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.strictEqual(v.reason, 'role-confirm');
  assert.strictEqual(v.crossTime, true);
}

// 다른 교시 + 제외 고사실 위반 (김이 101을 받게 됨) → 차단
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '101[1]']]; // 이의 101을 김이 받음
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.strictEqual(v.reason, 'room');
  assert.strictEqual(v.forbidden[0].i, 1);
  assert.strictEqual(v.forbidden[0].room, '101');
}

// 다른 교시인데 상대의 그 교시 자리가 이미 차 있음 → 차단(time-occupied)
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '999[1]', '203[1]']]; // 이의 1열이 차있음
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.strictEqual(v.reason, 'time-occupied');
  assert.strictEqual(v.who, 2);
  assert.strictEqual(v.col, 1);
}

// 다른 교시인데 상대 자리가 제외(빨강)라 들어갈 수 없음 → 차단
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '203[1]']];
  const m = { slotKeys: ['1_1', '1_2', '1_3'], excludedCells: { 2: { '1_1': true } } };
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, m);
  assert.strictEqual(v.reason, 'time-occupied');
  assert.strictEqual(v.who, 2);
}

// 다른 교시인데 상대 자리가 고정시간(파랑)이라 들어갈 수 없음 → 차단
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '203[1]']];
  const m = { slotKeys: ['1_1', '1_2', '1_3'], preFixed: { 2: { '1_1': { role: 1 } } } };
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, m);
  assert.strictEqual(v.reason, 'time-occupied');
}

// 다른 교시 + 한쪽만 빈칸 → "같은 교시에서 넘기라"고 안내(cross-needs-fill)
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '']]; // 김=1열206, 이=2열 빈칸
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.deepStrictEqual(v, { reason: 'cross-needs-fill' });
}

// 다른 교시 + 둘 다 빈칸 → 의미 없음(noop)
{
  const data = [['', '', ''], ['', '', ''], ['', '', '']];
  const v = classifySwap(data, teachers, { i: 1, j: 1 }, { i: 2, j: 2 }, maps);
  assert.deepStrictEqual(v, { reason: 'noop' });
}

// ─── crossTimeSwap 실제 동작: 각자 자기 열에 머물고 행만 바뀐다 ───────────────
{
  const data = [['', '', ''], ['', '206[1]', ''], ['', '', '203[1]']];
  crossTimeSwap(data, { i: 1, j: 1 }, { i: 2, j: 2 });
  // 김(1): 1열 비워지고 2열에 203 받음 / 이(2): 1열에 206 받음, 2열 비워짐
  assert.strictEqual(data[1][1], '');
  assert.strictEqual(data[1][2], '203[1]');
  assert.strictEqual(data[2][1], '206[1]');
  assert.strictEqual(data[2][2], '');
}

console.log('OK: classifySwap/crossTimeSwap 정상 동작 (같은교시 넘겨주기 + 다른교시 당번맞바꾸기)');
