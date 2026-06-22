// tests/distribute-quota.test.mjs — node tests/distribute-quota.test.mjs 로 실행
import assert from 'node:assert';
import { distributeQuota } from '../js/algorithm.js';

{
  const { quota, total } = distributeQuota(10, [100, 100, 100]);
  assert.strictEqual(total, 10);
  assert.deepStrictEqual(quota, [4, 3, 3]);
}

{
  const { quota, total } = distributeQuota(10, [1, 100, 100]);
  assert.strictEqual(total, 10);
  assert.strictEqual(quota[0], 1);
  assert.strictEqual(quota[1] + quota[2], 9);
}

{
  const { quota, total } = distributeQuota(10, [2, 2, 2]);
  assert.strictEqual(total, 6);
  assert.deepStrictEqual(quota, [2, 2, 2]);
}

console.log('OK: distributeQuota 정상 동작');
