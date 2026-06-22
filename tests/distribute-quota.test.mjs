// tests/distribute-quota.test.mjs — node tests/distribute-quota.test.mjs 로 실행
import assert from 'node:assert';
import { distributeQuota } from '../js/algorithm.js';

// 균등분배 안 될 때 위(앞쪽=어린교사)부터 자투리를 더 받는다
{
  const { quota, total } = distributeQuota(10, [100, 100, 100]); // 10명 아니고 3명, 한도 넉넉
  assert.strictEqual(total, 10);
  assert.deepStrictEqual(quota, [4, 3, 3]); // 10 = 4+3+3, 앞쪽이 더 받음
}

// 한도(못들어가는시간)에 걸리는 교사는 그만큼 적게 받고 나머지가 보충
{
  const { quota, total } = distributeQuota(10, [1, 100, 100]); // 교사0은 1시간만 가능
  assert.strictEqual(total, 10);
  assert.strictEqual(quota[0], 1);
  assert.strictEqual(quota[1] + quota[2], 9);
}

// 모두 한도 도달 → 필요시간을 다 못 채움
{
  const { quota, total } = distributeQuota(10, [2, 2, 2]); // 최대 6까지만 가능
  assert.strictEqual(total, 6);
  assert.deepStrictEqual(quota, [2, 2, 2]);
}

console.log('OK: distributeQuota 정상 동작');
