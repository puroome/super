// 실행: node js/allowlist.test.mjs
import { emailInList } from './allowlist.js';
import assert from 'node:assert/strict';

const list = ['  Teacher.A@Gmail.com ', 'b@school.kr'];
assert.equal(emailInList('teacher.a@gmail.com', list), true, '대소문자/공백 무시 매칭');
assert.equal(emailInList('B@SCHOOL.KR', list), true,        '명단 항목의 대소문자 무시');
assert.equal(emailInList('intruder@x.com', list), false,    '명단에 없는 계정 거부');
assert.equal(emailInList('', list), false,                  '빈 이메일 거부');
assert.equal(emailInList('a@b.com', null), false,           '명단 자체가 없으면 거부');
console.log('✓ allowlist 테스트 통과');
