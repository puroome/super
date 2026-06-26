# 감독배정앱 — 수동 교환(Swap) 규칙 개편 — 작업 인수인계 문서

이 문서는 다른 대화창(새 Claude 세션)에서 이어서 작업하기 위한 인수인계 자료입니다.
함께 첨부하는 `super-main-refactored.zip`이 **현재까지 반영된 최신 코드**입니다.
이 문서에 적힌 "최종 목표 규칙"대로 코드를 마무리해 주세요.

---

## 0. 앱 개요 (필수 배경)

- 시험 감독 자동배정 웹앱. 바닐라 HTML/CSS/JS, 빌드 도구 없음.
- 핵심 파일: `js/algorithm.js`(순수 로직, 테스트 가능) / `js/ui.js`(렌더링·이벤트·상태) / `js/firebase.js`(저장) / `js/print.js`(인쇄·엑셀).
- 자동배정 탭에 표(그리드)가 있음: 가로=시간(교시,슬롯), 세로=교사. 칸 하나(`data[i][j]`)는 그 교사가 그 시간에 어디서 어떤 역할로 감독인지를 나타냄.
- 칸 표기: `'101[1]'` = 101호+정감독(roleIdx=1), `'복도[2]'` = 복도+부감독(roleIdx=2), `'x'`=제외시간, `''`=빈칸.
- 절대 전제(가장 중요): **"특정 유형(정/부)의 감독이 필요한 고사실에는, 반드시 그 유형의 감독이 들어가 있어야 한다."** 어떤 교환·배정을 해도 이게 깨지면 안 됨.

### 칸 색깔 의미 (셀 상태)
| 색 | 뜻 | 데이터 위치 |
|---|---|---|
| 빨강 (X) | 제외시간 — 그 교시에 학교에 없어서 감독 불가 | `state.excludedCells[i][key]` 또는 cell==='x' |
| 파랑 | 고정(시간+유형) — 담당 과목 시험시간이라 그 교시엔 반드시 그 유형(정/부)으로 감독. 방만 유동적 | `state.preFixed[i][key] = {role: 1|2}` |
| 회색 | 더블클릭 고정 — 시간+고사실(방)까지 통째로 고정 | `state.fixedCells[i][j]` |
| 흰색(빈칸) | 그 시간 감독 없음 | `cell === ''` |
| 흰색(채워짐) | 보통 배정 (공정성 로직으로 자동배정된 칸, 유동적) | `cell === '101[1]'` 등 |
| 주황 (방미정) | 보직만 있고 방이 없는 비정상 상태(거의 안 나옴) | `roleIdx>0 && room===''` |

**중요**: "파랑(시간+유형 고정)"은 자동배정 실행 전에 `?`(유형 미지정) 상태를 거칠 수 있는데, 이미 `findPendingFixedCells()`가 검사해서 `?` 상태면 자동배정을 막고 있음 (수정 불필요, 이미 구현됨).

---

## 1. 지금까지 합의된 "교환(수동 swap)" 최종 규칙

화면 동작: 칸 2개를 클릭(선택)하고 "⇄ 선택 셀 교환" 버튼을 누름.

### 1-A. 셀 선택 가능 여부 (클릭 시 선택되는가)

| 셀 종류 | 선택 가능? |
|---|---|
| 빨강(X) | 불가 |
| 파랑(고정 시간+유형) | 불가 |
| 회색(고정 시간+방) | 불가 |
| 흰색 빈칸 | 가능 (★ 이번에 새로 허용해야 함 — 아래 1-C 참고) |
| 흰색 채워짐(보통 배정) | 가능 |

→ **즉 "선택 가능 = 빨강도 아니고 파랑도 아니고 회색도 아닌 모든 칸"**. 빈칸도 이제 선택돼야 함.

### 1-B. "교환" 버튼을 눌렀을 때 — 두 칸의 시간(슬롯)이 같은가/다른가로 분기

#### (가) 같은 시간(같은 열)일 때 — "방 맞바꾸기"
두 칸의 **내용을 그대로 swap**(지금 `swapCells`가 하는 것과 같음). 결과적으로 방은 같은 시간대에 그대로 있고, 누가 그 방을 맡는지만 바뀜.

| 세부 상황 | 처리 |
|---|---|
| 둘 다 같은 유형 (정↔정, 부↔부) | 조용히 바로 교환 |
| 유형이 다름 (정↔부) | 확인창: "두 선생님의 감독 유형이 서로 바뀝니다. (A: 정감독→부감독 / B: 부감독→정감독) 계속하시겠습니까?" → 확인 시 교환 |
| 한쪽이 빈칸 (한쪽만 감독이 있고 한쪽은 없음, "넘겨주기") | 확인창: "B 선생님의 감독을 A 선생님에게 넘기는 것입니다. (A: 감독없음→정감독(101호) / B: 정감독(101호)→감독없음) 계속하시겠습니까?" → 확인 시 교환 |
| 둘 다 빈칸 | 의미 없는 교환이므로 그냥 아무 일도 안 일어나거나 "변경사항 없음" toast (택1, 굳이 막을 필요는 없음) |
| 결과적으로 누군가 제외 고사실로 들어가게 됨 | 차단 + 설명 모달 (이미 구현됨, 그대로 유지) |

> 제외 고사실 검사는 유형 확인/넘겨주기 확인보다 **먼저** 수행해서, 제외 고사실 위반이면 confirm 창 띄우지 않고 바로 차단해야 함 (사용자가 괜한 확인을 누르고 나서 차단당하면 안 됨).

#### (나) 다른 시간(다른 열)일 때 — "당번 맞바꾸기" (★ 아직 미구현, 새로 만들어야 함)

**핵심 개념**: 칸이 가로(시간)로 이동하는 게 아니라, **각자 자기 시간(열)에 그대로 있으면서, 그 열 안에서 다른 교사(행)로 위아래 이동**하는 것.

예시 (이해를 위한 예 — 실제 데이터 아님):
```
            1교시(열)         7교시(열)
[전] A      206호             (빈칸)
     B      (빈칸)            203호

[후] A      (빈칸)            203호   ← B의 7교시 당번을 넘겨받음
     B      206호             (빈칸)   ← A의 1교시 당번을 넘겨받음
```

구현 의미: **"각자 자기 시간 열에서, 행(교사)만 바뀐다"**
- A가 선택한 칸의 시간은 `A.j`. 거기 있던 값(`data[A.i][A.j]`)은 그 시간(A.j열)에 그대로 있고, 행만 B.i로 바뀜.
- B가 선택한 칸의 시간은 `B.j`. 거기 있던 값(`data[B.i][B.j]`)은 그 시간(B.j열)에 그대로 있고, 행만 A.i로 바뀜.

요약 코드 형태:
```js
function crossTimeSwap(data, c1, c2) {
  // c1, c2: {i, j}  (c1.j !== c2.j 전제)
  const val1 = data[c1.i][c1.j]; // A가 원래 가진 것 (시간=c1.j)
  const val2 = data[c2.i][c2.j]; // B가 원래 가진 것 (시간=c2.j)
  data[c1.i][c1.j] = '';         // A의 c1.j 자리 비움
  data[c2.i][c2.j] = '';         // B의 c2.j 자리 비움
  data[c2.i][c1.j] = val1;       // val1(시간=c1.j)을 B의 줄로 이동
  data[c1.i][c2.j] = val2;       // val2(시간=c2.j)을 A의 줄로 이동
}
```

**되는 조건 (모두 만족해야 함)**:
1. `data[c2.i][c1.j]`가 비어있어야 함 (B가 A의 시간(c1.j)에 원래 비어 있었어야, A의 당번을 받을 수 있음). 안 비어있으면(이미 다른 배정 있음, 또는 그 시간이 제외(X)이거나 고정(파랑/회색)이면) → 차단.
2. `data[c1.i][c2.j]`가 비어있어야 함 (대칭적으로 A가 B의 시간(c2.j)에 비어 있었어야 함). 안 그러면 → 차단.
3. 옮겨진 결과 둘 다 제외 고사실 위반이 없어야 함 (A가 받은 방이 A의 제외 고사실이 아닌지, B가 받은 방이 B의 제외 고사실이 아닌지).
4. 위 1,2 검사 시, "비어있어야 함"은 단순히 `''`인지만 보는 게 아니라 — 그 칸이 고정(파랑/회색)이거나 제외(X)라면 그 시간에 다른 사람이 들어올 수 없는 자리이므로 똑같이 차단. (방어적으로 명시 검사 권장)
5. 유형이 같으면 조용히 진행, 다르면 (가)와 동일하게 "유형이 바뀝니다" 확인창.
6. 한쪽만 값이 있고 다른 쪽 자리도 원래 빈칸인 경우(빈칸끼리 이동) — 막을 필요 없이 허용해도 무방함(사실상 의미 없는 이동이라 자연히 무해함).

**차단 시 오류 메시지 예시**:
- "이 교환을 하려면 B 선생님이 [날짜] [N교시]에 비어 있어야 해요. 현재 다른 배정이 있습니다." (또는 "제외시간/고정 시간이라 들어갈 수 없습니다.")

---

## 2. 셀 선택 로직 수정 (1-A 반영)

`ui.js`의 `onCellClick` 함수에서 빈칸도 선택 가능하도록 수정해야 함.

현재 코드 (최신 zip 기준, `onCellClick` 내부):
```js
const isManualFixed = !!state.fixedCells[i]?.[j];
const isExcludedCell = (key ? !!state.excludedCells[i]?.[key] : false) || cell.toLowerCase() === 'x';
const isEmpty = cell === '' || cell === '0' || cell === 0;
if (isManualFixed || isEmpty || isExcludedCell) return;
```
→ **`isEmpty` 조건을 선택 차단에서 빼야 함.** (단, 파랑(`state.preFixed`)은 이미 이전 단계에서 선택 가능하게 풀려 있어야 함 — 최신 zip에서 그렇게 되어 있는지 확인. `isPreFixed`가 차단 목록에 다시 들어가 있다면 빼야 함.)

수정 후 의도:
```js
const isManualFixed = !!state.fixedCells[i]?.[j];          // 회색 — 차단
const isPreFixedBlue = key ? !!state.preFixed[i]?.[key] : false; // 파랑 — 차단
const isExcludedCell = (...) || cell.toLowerCase() === 'x'; // 빨강 — 차단
// isEmpty는 더 이상 차단 사유 아님!
if (isManualFixed || isPreFixedBlue || isExcludedCell) return;
```

> 주의: `cell === '0'`인 경우가 있는데, 일반 빈칸과 동일하게 취급(=선택 가능)하면 됨.

---

## 3. `algorithm.js`에 이미 구현되어 있는 것 (재사용할 것, 다시 만들지 말 것)

최신 zip의 `js/algorithm.js`에는 이미 아래 순수 함수들이 있고 export 되어 있음:

```js
function isForbiddenRoom(teacher, roomName) { ... }       // 제외 고사실 판정
function findUncoveredRooms(data, roomRequirements, slots) { ... } // 감독 없는 고사실 찾기
function classifySwap(data, teachers, c1, c2) { ... }     // 같은시간 교환 판정 (시간다름/제외고사실/유형다름 반환)
```

`classifySwap`의 현재 동작(같은 시간 케이스용으로 이미 만들어둔 것):
```js
function classifySwap(data, teachers, c1, c2) {
  const cell1 = String(data?.[c1.i]?.[c1.j] ?? '');
  const cell2 = String(data?.[c2.i]?.[c2.j] ?? '');
  if (c1.j !== c2.j) return { reason: 'time' };  // ← 이 분기를 "다른시간=당번맞바꾸기"로 바꿔야 함!
  const roomForC1 = extractRoom(cell2);
  const roomForC2 = extractRoom(cell1);
  const forbidden = [];
  if (isForbiddenRoom(teachers[c1.i - 1], roomForC1)) forbidden.push({ i: c1.i, room: roomForC1 });
  if (isForbiddenRoom(teachers[c2.i - 1], roomForC2)) forbidden.push({ i: c2.i, room: roomForC2 });
  if (forbidden.length) return { reason: 'room', forbidden };
  const role1 = extractRole(cell1);
  const role2 = extractRole(cell2);
  if (role1 !== role2) return { reason: 'role-confirm', role1, role2 };
  return { ok: true };
}
```

**이번 작업에서 할 일**: 이 함수를 확장해서, `c1.j !== c2.j`일 때 단순 `{reason:'time'}`(차단)으로 끝내지 말고, 위 1-B-(나)의 "당번 맞바꾸기" 판정 로직을 추가해야 함. 그리고 같은 시간 케이스에서도 "한쪽이 빈칸이면 넘겨주기 확인" 분기(예: `reason: 'transfer-confirm'`)를 추가해야 함.

권장 반환값 형태 (예시, 그대로 안 따라도 되지만 일관성 유지):
```js
{ ok: true }                                              // 조용히 진행
{ reason: 'role-confirm', role1, role2 }                  // 같은시간, 유형다름 확인
{ reason: 'transfer-confirm', from, to, role }            // 한쪽 빈칸 넘겨주기 확인 (같은시간/다른시간 공통 사용 가능)
{ reason: 'room', forbidden: [...] }                      // 제외고사실 차단
{ reason: 'time-occupied', who, slotLabel }               // 다른시간인데 상대 칸이 이미 차있음(또는 고정/제외라 못들어감) → 차단
{ ok: true, crossTime: true }                             // 다른시간이고 조건 통과 → 당번맞바꾸기로 실제 교환 수행
```
(reason 이름은 자유, ui.js의 `doSwap`과 맞춰서 일관되게만 하면 됨)

---

## 4. `ui.js`의 현재 `doSwap` (최신 zip 기준, 참고용 — 이걸 위 규칙에 맞게 다시 작성해야 함)

```js
function doSwap() {
  if (state.selectedCells.length !== 2) return;
  const [c1, c2] = state.selectedCells;

  const getName = (c) => state.teachers[c.i - 1]?.name ?? `#${c.i}`;
  const slotLabel = (c) => {
    const s = state.slots[c.j - 1];
    return s ? `${s.dayIdx}일차 ${s.period}교시` : `${c.j}번 칸`;
  };
  const clearSel = () => { state.selectedCells = []; renderAssignGrid(); };

  const verdict = classifySwap(state.data, state.teachers, c1, c2);

  if (verdict.reason === 'time') { /* 차단 — 이 분기를 당번맞바꾸기로 교체해야 함 */ }
  if (verdict.reason === 'room') { /* 차단 — 유지 */ }
  if (verdict.reason === 'role-confirm') { /* confirm() 후 진행 — 유지, 빈칸 넘겨주기 분기 추가 필요 */ }

  if (swapCells(state.data, state.fixedCells, c1.i, c1.j, c2.i, c2.j)) { /* 같은시간 swap 실행 — 유지 */ }
}
```

**참고**: `swapCells`(algorithm.js)는 `fixedMap`(회색, 시간+방 고정)만 검사해서 차단하고 있음 — 그대로 두면 됨. 회색 칸은 애초에 선택 자체가 안 되니 사실 이 내부 체크는 이중 안전장치임.

---

## 5. 작업 순서 제안

1. `algorithm.js`의 `classifySwap`을 위 3번 스펙대로 확장 (당번맞바꾸기 판정 + 빈칸 넘겨주기 판정 추가). 순수 함수이므로 테스트부터 작성 권장 (`tests/swap-rules.test.mjs`에 이미 같은시간 케이스 테스트가 있으니 거기에 추가).
2. `ui.js`의 `onCellClick`에서 빈칸 선택 차단 제거 (2번 스펙).
3. `ui.js`의 `doSwap`을 새 `classifySwap` 반환값에 맞춰 재작성. 다른시간 케이스는 실제 `data` 조작(`crossTimeSwap`류 로직, 위 1-B-(나) 코드 참고)을 `algorithm.js`에 순수 함수로 만들어 `swapCells`처럼 export하고, `ui.js`에서 그걸 호출하는 구조 권장 (로직을 ui.js에 직접 쓰지 말 것 — 테스트 어려워짐).
4. 모달 문구는 기존에 만들어둔 `showErrorModal({title, desc, errors, fix})` 패턴 그대로 사용. confirm은 브라우저 기본 `confirm()` 사용 (기존 role-confirm 처리와 동일 패턴).
5. 작업 끝나면 `npm test`(`node tests/run.mjs`)로 전체 테스트 통과 확인. 최신 zip 기준 12/12 통과 상태이므로, 새로 추가한 테스트까지 전부 통과해야 함.
6. 실제 동작 점검은 자동배정 탭에서: (a) 같은시간 정↔정 조용히 교환 (b) 같은시간 정↔부 확인창 (c) 같은시간 빈칸↔채워짐 넘겨주기 확인창 (d) 다른시간 둘다 조건 맞아서 당번교환 (e) 다른시간인데 상대자리 이미 차있어서 차단 (f) 제외고사실 위반 차단 — 6가지 모두 확인.

---

## 6. 이미 완료되어 있고 다시 손댈 필요 없는 것 (이번 zip에 이미 반영됨)

- 감독 없는 고사실 경고 (`findUncoveredRooms`, `runAssign` 내 경고 모달)
- "방 미정" 칸 주황 표시 (`gridCellDisplay`)
- 이름/제외고사실 입력값 큰따옴표 escape 버그 수정
- 죽은 테스트(distribute-quota) 삭제, 깨진 테스트 4개 복구
- `package.json` + `tests/run.mjs` (한 번에 테스트 실행)
- 제외 고사실로 들어가는 교환 차단 (이번 스펙으로 일부 흡수/확장됨 — `classifySwap`의 `room` reason)

이 항목들은 그대로 유지하고, 이번 작업(교환 규칙 확장)만 추가로 하면 됩니다.

---

## 7. 사용자(K) 커뮤니케이션 스타일 참고

- 코드 비전문가. 전문 용어 쓰지 말고 아주 쉽게, 예시로 설명할 것.
- "교체 전/교체 후" 형식의 최소 diff 선호. 전체 파일 재작성은 지양.
- 변경 완료 후 항상 "하나씩 점검해보세요" 식의 구체적인 점검 가이드를 제공할 것.
- 결정이 필요한 사항은 객관식(보기 2~3개)으로 묻고, 그 전엔 코드 작성하지 말 것.
