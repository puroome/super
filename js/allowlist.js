// allowlist.js — 허용 이메일 매칭 (순수 함수, 테스트 가능)
// 대소문자·앞뒤 공백을 무시하고 명단 포함 여부를 판정한다.
export function emailInList(email, list) {
  if (!email || !Array.isArray(list)) return false;
  const norm = (e) => String(e).trim().toLowerCase();
  const target = norm(email);
  return list.some((e) => norm(e) === target);
}
