// tests/forbidden-swap.test.mjs — node tests/forbidden-swap.test.mjs 로 실행
// 수동 교환을 막을 때 쓰는 제외 고사실 판정이 정확한지 검증한다.
import assert from 'node:assert';
import { isForbiddenRoom } from '../js/algorithm.js';

const t = { name: '김', forbiddenRooms: '101, 복도' };

assert.strictEqual(isForbiddenRoom(t, '101'), true);
assert.strictEqual(isForbiddenRoom(t, '복도'), true);
assert.strictEqual(isForbiddenRoom(t, '102'), false);
assert.strictEqual(isForbiddenRoom(t, ''), false);               // 빈 방이름 → 위반 아님
assert.strictEqual(isForbiddenRoom({ name: '이' }, '101'), false); // 제외목록 자체가 없음
assert.strictEqual(isForbiddenRoom(t, '10'), false);             // 부분일치 아님 (101 ≠ 10)

console.log('OK: isForbiddenRoom 정상 동작');
