// tests/grid-cell-display.test.mjs — node tests/grid-cell-display.test.mjs 로 실행
import assert from 'node:assert';
import { csvField, gridCellDisplay } from '../js/algorithm.js';

// csvField: 쉼표/따옴표 있는 값만 따옴표로 감싸기
{
  assert.strictEqual(csvField('101'), '101');
  assert.strictEqual(csvField('101, 102'), '"101, 102"');
  assert.strictEqual(csvField('a"b'), '"a""b"');
  assert.strictEqual(csvField(''), '');
  assert.strictEqual(csvField(undefined), '');
}

// gridCellDisplay: 고정(파랑) > 제외시간 x(빨강) > 기본(흰색), [역할번호] 표기는 안 보임
{
  assert.deepStrictEqual(gridCellDisplay('', false), { bg: '#fff', text: '' });
  assert.deepStrictEqual(gridCellDisplay('x', false), { bg: '#fbdada', text: 'X' });
  assert.deepStrictEqual(gridCellDisplay('202[2]', false), { bg: '#fff', text: '202' });
  assert.deepStrictEqual(gridCellDisplay('1', true), { bg: '#cfe3fa', text: '1' });
  // 고정시간으로 배정된 칸은 x여도 파란색이 우선
  assert.deepStrictEqual(gridCellDisplay('x', true).bg, '#cfe3fa');
  // 방 번호 없이 역할만 있는 칸(방 미배정) — 빈칸으로 숨기지 않고 '방미정'+주황으로 표시
  assert.deepStrictEqual(gridCellDisplay('[1]', false), { bg: '#ffe0b2', text: '방미정' });
}

console.log('OK: csvField/gridCellDisplay 정상 동작');
