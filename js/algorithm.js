// algorithm.js — 시험감독 자동배정 알고리즘 (VBA → JS)

const FIXED_COLOR = 'fixed';

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function extractRole(str) {
  const m = String(str).match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : 0;
}

function extractRoom(str) {
  return String(str).split('[')[0];
}

function isInArray(arr, val) {
  return Array.isArray(arr) && arr.includes(val);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── 데이터 파싱 ──────────────────────────────────────────────────────────────

/**
 * 시험 슬롯 목록 생성
 * examDays: [{date, startPeriod, endPeriod}]
 * → [{dayIdx, period}] 1-based
 */
function buildSlots(examDays) {
  const slots = [];
  examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      slots.push({ dayIdx: di + 1, period: p });
    }
  });
  return slots;
}

/**
 * 필요감독배열 빌드
 * requirements: [{dayIdx, period, roleIdx, count}]
 * → scheduleData[dayIdx][period][roleIdx] = count
 */
function buildRequirementsArray(requirements, maxDay, maxPeriod, roleCount) {
  // 3D array, 1-based
  const arr = [];
  for (let d = 0; d <= maxDay; d++) {
    arr[d] = [];
    for (let p = 0; p <= maxPeriod; p++) {
      arr[d][p] = new Array(roleCount + 1).fill(0);
    }
  }
  requirements.forEach(r => {
    if (arr[r.dayIdx] && arr[r.dayIdx][r.period]) {
      arr[r.dayIdx][r.period][r.roleIdx] = r.count;
    }
  });
  return arr;
}

/**
 * totalTeachersForSlot: 특정 날짜/교시에 필요한 총 감독 수
 */
function totalTeachersForSlot(scheduleData, dayIdx, period, roleCount) {
  let total = 0;
  for (let r = 1; r <= roleCount; r++) {
    total += (scheduleData[dayIdx]?.[period]?.[r] ?? 0);
  }
  return total;
}

/**
 * 보직별 고사실 배열 반환
 * roomRequirements: [{dayIdx, period, roleIdx, roomName, count}]
 */
function getRoomsForRole(roomRequirements, dayIdx, period, roleIdx) {
  const arr = [];
  roomRequirements
    .filter(r => r.dayIdx === dayIdx && r.period === period && r.roleIdx === roleIdx)
    .forEach(r => {
      for (let k = 0; k < r.count; k++) arr.push(r.roomName);
    });
  return arr;
}

/**
 * 교사별 배정불가 고사실 배열
 * teachers: [{name, forbiddenRooms: '1-1,1-2'}]
 */
function getForbiddenRooms(teacher) {
  const val = teacher.forbiddenRooms || '';
  if (!val.trim()) return ['__none__'];
  const parts = val.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : ['__none__'];
}

/**
 * 배정감독수 CSV 파싱 (순수 함수, DOM/state 의존 없음)
 * CSV 헤더: 날짜,교시,보직,고사실1,고사실2,...
 * 날짜/보직명은 examDays/roles에 등록된 값과 정확히 일치해야 매칭됨
 * @returns {{roomRequirements: Array, errors: string[]}}
 */
function parseRequirementsCSV(text, examDays, roles) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const header = lines[0].split(',').map(s => s.trim());
  const roomCols = header.slice(3);
  const errors = [];
  const roomRequirements = [];

  lines.slice(1).forEach((line, rowIdx) => {
    const parts = line.split(',').map(s => s.trim());
    const [dateStr, periodStr, roleName] = parts;
    const counts = parts.slice(3);
    const dayIdx = examDays.findIndex(d => d.date === dateStr) + 1;
    const period = parseInt(periodStr);
    const roleIdx = roles.findIndex(r => r.name === roleName) + 1;

    if (!dayIdx) { errors.push(`${rowIdx + 2}행: 날짜 "${dateStr}"가 기본정보에 없습니다.`); return; }
    if (!roleIdx) { errors.push(`${rowIdx + 2}행: 보직 "${roleName}"이 기본정보에 없습니다.`); return; }

    roomCols.forEach((room, ci) => {
      const count = parseInt(counts[ci]) || 0;
      if (count > 0) roomRequirements.push({ dayIdx, period, roleIdx, roomName: room, count });
    });
  });

  return { roomRequirements, errors };
}

// ─── P값 기반 배정 ────────────────────────────────────────────────────────────

function calcPValues(data, fixedMap, slots, teachers, slotNeeds) {
  // 행P값 (교사별): (배정할시간 - 현재배정수) / (남은빈슬롯수)
  // 열P값 (슬롯별): (필요인원 - 현재배정수) / (배정가능교사수 - x수)
  const tCount = teachers.length;
  const sCount = slots.length;

  const rowP = new Array(tCount + 1).fill(-100);
  const colP = new Array(sCount + 1).fill(-100);

  for (let i = 1; i <= tCount; i++) {
    const quota = teachers[i - 1].quota ?? 0; // 배정할 시간
    let assigned = 0, available = 0;
    for (let j = 1; j <= sCount; j++) {
      const v = data[i][j];
      if (v === 1) assigned++;
      if (v === '' || v === 0) available++;
    }
    const remain = quota - assigned;
    rowP[i] = available > 0 ? remain / available : -100;
  }

  for (let j = 1; j <= sCount; j++) {
    const need = slotNeeds[j] ?? 0;
    let assigned = 0, xCount = 0, possible = 0;
    for (let i = 1; i <= tCount; i++) {
      const v = data[i][j];
      if (v === 1) assigned++;
      else if (String(v).toLowerCase() === 'x') xCount++;
      else if (v === '' || v === 0) possible++;
    }
    const remain = need - assigned;
    const denom = tCount - xCount - assigned;
    colP[j] = denom > 0 ? remain / denom : -100;
  }

  return { rowP, colP };
}

function findMax(rowP, colP, tCount, sCount) {
  let maxVal = -Infinity, maxIdx = -1;

  // 행 먼저 (0 ~ tCount-1 offset)
  for (let i = 1; i <= tCount; i++) {
    if (rowP[i] > maxVal && rowP[i] <= 1) {
      maxVal = rowP[i];
      maxIdx = i - 1; // row offset
    }
  }
  // 열 (tCount ~ tCount+sCount-1 offset)
  for (let j = 1; j <= sCount; j++) {
    if (colP[j] > maxVal && colP[j] <= 1) {
      maxVal = colP[j];
      maxIdx = tCount + j - 1; // col offset
    }
  }
  return { maxIdx, maxVal };
}

function insertOneInRow(data, fixedMap, rowIdx, colP, sCount) {
  // 빈 슬롯 중 colP 가장 높은 곳에 1
  let bestP = -Infinity, bestJ = -1;
  for (let j = 1; j <= sCount; j++) {
    if ((data[rowIdx][j] === '' || data[rowIdx][j] === 0) && !fixedMap[rowIdx][j]) {
      if (colP[j] > bestP) { bestP = colP[j]; bestJ = j; }
    }
  }
  if (bestJ > 0 && bestP > 0) { data[rowIdx][bestJ] = 1; return true; }
  return false;
}

function insertOneInCol(data, fixedMap, colIdx, rowP, tCount) {
  let bestP = -Infinity, bestI = -1;
  for (let i = 1; i <= tCount; i++) {
    if ((data[i][colIdx] === '' || data[i][colIdx] === 0) && !fixedMap[i][colIdx]) {
      if (rowP[i] > bestP) { bestP = rowP[i]; bestI = i; }
    }
  }
  if (bestI > 0 && bestP > 0) { data[bestI][colIdx] = 1; return true; }
  return false;
}

function fillEmptySlots(data, fixedMap, rowP, colP, tCount, sCount) {
  // 남은배정 양수 교사 & 남은배정 양수 슬롯 교차점에 1
  for (let i = 1; i <= tCount; i++) {
    if (rowP[i] <= 0) continue;
    for (let j = 1; j <= sCount; j++) {
      if (colP[j] <= 0) continue;
      if ((data[i][j] === '' || data[i][j] === 0) && !fixedMap[i][j]) {
        data[i][j] = 1;
        return true;
      }
    }
  }
  return false;
}

function swapToFill(data, fixedMap, rowP, colP, tCount, sCount) {
  // 배정 초과된 슬롯의 1을 배정 부족 교사에게 이동
  for (let i = 1; i <= tCount; i++) {
    if (rowP[i] <= 0) continue;
    for (let j = 1; j <= sCount; j++) {
      if (data[i][j] !== '' && data[i][j] !== 0) continue;
      if (fixedMap[i][j]) continue;
      // j슬롯에 1인 다른 교사 찾기 (rowP <= 0)
      for (let k = 1; k <= tCount; k++) {
        if (k === i) continue;
        if (data[k][j] === 1 && !fixedMap[k][j] && rowP[k] < 0) {
          // k의 다른 슬롯 중 비어있는 곳 찾기
          for (let l = 1; l <= sCount; l++) {
            if (l === j) continue;
            if ((data[i][l] === '' || data[i][l] === 0) && !fixedMap[i][l] &&
                (data[k][l] === '' || data[k][l] === 0) && !fixedMap[k][l]) {
              data[i][j] = 1; data[k][j] = 0;
              data[k][l] = 1; data[i][l] = 0;
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function fillZeros(data, tCount, sCount) {
  for (let i = 1; i <= tCount; i++)
    for (let j = 1; j <= sCount; j++)
      if (data[i][j] === '' || data[i][j] === undefined) data[i][j] = 0;
}

/**
 * ① assignTeachers: 0/1 매트릭스 채우기
 */
function assignTeachers(data, fixedMap, slots, teachers, slotNeeds) {
  const tCount = teachers.length;
  const sCount = slots.length;
  let failCount = 0;

  while (true) {
    const { rowP, colP } = calcPValues(data, fixedMap, slots, teachers, slotNeeds);
    const { maxIdx, maxVal } = findMax(rowP, colP, tCount, sCount);

    if (maxVal === 0 || maxVal === -100 || maxIdx === -1) { fillZeros(data, tCount, sCount); return; }

    let ok = false;
    if (maxIdx < tCount) {
      ok = insertOneInRow(data, fixedMap, maxIdx + 1, colP, sCount);
    } else {
      ok = insertOneInCol(data, fixedMap, maxIdx - tCount + 1, rowP, tCount);
    }

    if (!ok) {
      failCount++;
      if (failCount === 1) ok = fillEmptySlots(data, fixedMap, rowP, colP, tCount, sCount);
      if (!ok && failCount === 1) ok = swapToFill(data, fixedMap, rowP, colP, tCount, sCount);
      if (!ok && failCount >= 2) { fillZeros(data, tCount, sCount); return; }
      if (ok) failCount = 0;
    } else {
      failCount = 0;
    }
  }
}

// ─── ② 날짜분산 ───────────────────────────────────────────────────────────────

function getTeacherDailyCount(data, fixedMap, slots, teacherIdx, tCount, sCount) {
  // dayIdx별 배정 수
  const counts = {};
  for (let j = 1; j <= sCount; j++) {
    const d = slots[j - 1].dayIdx;
    if (!counts[d]) counts[d] = 0;
    if (data[teacherIdx][j] === 1) counts[d]++;
  }
  return counts;
}

function getTeacherDailyEmpty(data, slots, teacherIdx, sCount) {
  const counts = {};
  for (let j = 1; j <= sCount; j++) {
    const d = slots[j - 1].dayIdx;
    if (!counts[d]) counts[d] = 0;
    if (data[teacherIdx][j] === 0) counts[d]++;
  }
  return counts;
}

function disperseByDate(data, fixedMap, slots, tCount, sCount) {
  // ponytail: 최대 100회 반복으로 수렴 보장
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (let i = 1; i <= tCount; i++) {
      const dailyCount = getTeacherDailyCount(data, fixedMap, slots, i, tCount, sCount);
      const dailyEmpty = getTeacherDailyEmpty(data, slots, i, sCount);
      const days = Object.keys(dailyCount).map(Number);

      for (const highDay of days) {
        for (const lowDay of days) {
          if (dailyCount[highDay] - (dailyCount[lowDay] ?? 0) <= 1) continue;
          if ((dailyEmpty[lowDay] ?? 0) === 0) continue;

          // highDay에서 1 찾아 lowDay의 빈칸과 교환할 파트너 탐색
          for (let j1 = 1; j1 <= sCount; j1++) {
            if (slots[j1 - 1].dayIdx !== highDay) continue;
            if (data[i][j1] !== 1 || fixedMap[i][j1]) continue;

            for (let k = 1; k <= tCount; k++) {
              if (k === i) continue;
              // k가 j1에 없고 lowDay의 어딘가에 1
              if (data[k][j1] !== 0) continue;
              if (fixedMap[k][j1]) continue;

              for (let j2 = 1; j2 <= sCount; j2++) {
                if (slots[j2 - 1].dayIdx !== lowDay) continue;
                if (data[i][j2] !== 0 || fixedMap[i][j2]) continue;
                if (data[k][j2] !== 1 || fixedMap[k][j2]) continue;

                data[i][j1] = 0; data[k][j1] = 1;
                data[i][j2] = 1; data[k][j2] = 0;
                changed = true;
                break;
              }
              if (changed) break;
            }
            if (changed) break;
          }
          if (changed) break;
        }
        if (changed) break;
      }
    }
    if (!changed) break;
  }
}

// ─── ③ 연속감독 분산 ──────────────────────────────────────────────────────────

function maxConsecutive(data, teacherIdx, daySlots) {
  let max = 0, cur = 0;
  for (const j of daySlots) {
    if (data[teacherIdx][j] === 1) { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

function buildDaySlotMap(slots, sCount) {
  const map = {}; // dayIdx → [slotIdx 1-based]
  for (let j = 1; j <= sCount; j++) {
    const d = slots[j - 1].dayIdx;
    if (!map[d]) map[d] = [];
    map[d].push(j);
  }
  return map;
}

function trySwapConsecutive(data, fixedMap, slots, daySlotMap, teacherA, swapCol, swapDay, tCount, sCount, maxAllowed) {
  for (let b = 1; b <= tCount; b++) {
    if (b === teacherA) continue;
    if (data[b][swapCol] !== 0 || fixedMap[b][swapCol]) continue;

    for (let j = 1; j <= sCount; j++) {
      if (j === swapCol) continue;
      if (data[teacherA][j] !== 0 || fixedMap[teacherA][j]) continue;
      if (data[b][j] !== 1 || fixedMap[b][j]) continue;

      // 시뮬레이션
      data[b][swapCol] = 1;
      const jDay = slots[j - 1].dayIdx;
      if (jDay === swapDay) data[b][j] = 0;
      const bConsec = maxConsecutive(data, b, daySlotMap[swapDay] || []);
      data[b][swapCol] = 0;
      if (jDay === swapDay) data[b][j] = 1;

      if (bConsec >= maxAllowed) continue;

      data[teacherA][swapCol] = 0; data[b][swapCol] = 1;
      data[teacherA][j] = 1; data[b][j] = 0;
      return true;
    }
  }
  return false;
}

function trySwapSameDay(data, fixedMap, daySlotMap, teacherA, swapCol, swapDay, tCount) {
  const dayCols = daySlotMap[swapDay] || [];
  for (const altCol of dayCols) {
    if (altCol === swapCol) continue;
    if (data[teacherA][altCol] !== 0 || fixedMap[teacherA][altCol]) continue;

    data[teacherA][swapCol] = 0; data[teacherA][altCol] = 1;
    const aConsec = maxConsecutive(data, teacherA, dayCols);
    data[teacherA][swapCol] = 1; data[teacherA][altCol] = 0;
    if (aConsec >= 2) continue;

    for (let b = 1; b <= tCount; b++) {
      if (b === teacherA) continue;
      if (data[b][swapCol] !== 0 || fixedMap[b][swapCol]) continue;
      if (data[b][altCol] !== 1 || fixedMap[b][altCol]) continue;

      data[b][swapCol] = 1; data[b][altCol] = 0;
      const bConsec = maxConsecutive(data, b, dayCols);
      data[b][swapCol] = 0; data[b][altCol] = 1;
      if (bConsec >= 2) continue;

      data[teacherA][swapCol] = 0; data[b][swapCol] = 1;
      data[teacherA][altCol] = 1; data[b][altCol] = 0;
      return true;
    }
  }
  return false;
}

function disperseConsecutive(data, fixedMap, slots, tCount, sCount) {
  const daySlotMap = buildDaySlotMap(slots, sCount);
  const days = Object.keys(daySlotMap).map(Number);

  // Phase 1: 3연속 이상 분산
  for (let iter = 0; iter < 50; iter++) {
    let improved = false;
    for (let i = 1; i <= tCount; i++) {
      for (const d of days) {
        const dayCols = daySlotMap[d];
        if (dayCols.length < 3) continue;
        let maxLen = 0, maxStart = -1, curLen = 0, curStart = -1;
        for (let p = 0; p < dayCols.length; p++) {
          if (data[i][dayCols[p]] === 1) {
            if (curLen === 0) curStart = p;
            curLen++;
            if (curLen > maxLen) { maxLen = curLen; maxStart = curStart; }
          } else curLen = 0;
        }
        if (maxLen < 3) continue;
        const swapPos = maxStart + Math.floor(maxLen / 2);
        const swapCol = dayCols[swapPos];
        if (fixedMap[i][swapCol]) continue;
        if (trySwapConsecutive(data, fixedMap, slots, daySlotMap, i, swapCol, d, tCount, sCount, 3)) improved = true;
      }
    }
    if (!improved) break;
  }

  // Phase 2: 2연속 분산
  for (let iter = 0; iter < 30; iter++) {
    let improved = false;
    for (let i = 1; i <= tCount; i++) {
      for (const d of days) {
        const dayCols = daySlotMap[d];
        if (dayCols.length < 3) continue;
        let maxLen = 0, consecStart = -1, curLen = 0, curStart = -1;
        for (let p = 0; p < dayCols.length; p++) {
          if (data[i][dayCols[p]] === 1) {
            if (curLen === 0) curStart = p;
            curLen++;
            if (curLen > maxLen) { maxLen = curLen; consecStart = curStart; }
          } else curLen = 0;
        }
        if (maxLen !== 2) continue;
        let swapPos = consecStart;
        let swapCol = dayCols[swapPos];
        if (fixedMap[i][swapCol]) {
          swapPos = consecStart + 1;
          swapCol = dayCols[swapPos];
          if (fixedMap[i][swapCol]) continue;
        }
        if (trySwapSameDay(data, fixedMap, daySlotMap, i, swapCol, d, tCount)) improved = true;
      }
    }
    if (!improved) break;
  }
}

// ─── ④ 보직배정 ───────────────────────────────────────────────────────────────

function assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, tCount, sCount) {
  // 업무강도 누적 배열 (1-based)
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    workload[i] = teachers[i - 1].prevWorkload ?? 0;
  }

  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    const roleCount = roles.length;

    // 남은 인원 배열
    const remain = new Array(roleCount + 1).fill(0);
    for (let r = 1; r <= roleCount; r++) {
      remain[r] = scheduleData[dayIdx]?.[period]?.[r] ?? 0;
    }

    // 1단계: 고정셀 먼저
    for (let i = 1; i <= tCount; i++) {
      if (!fixedMap[i][j] || data[i][j] !== 1) continue;
      // 이미 보직 기입된 고정셀은 건너뜀
      if (extractRole(String(data[i][j])) > 0) {
        const r = extractRole(String(data[i][j]));
        if (remain[r] > 0) remain[r]--;
        continue;
      }
      // 남은 보직 중 선택 요청 → 여기선 첫 번째 가능한 보직으로 자동 배정
      // ponytail: UI에서 고정셀 보직 선택 모달 처리, 여기선 auto-assign
      for (let r = 1; r <= roleCount; r++) {
        if (remain[r] > 0) {
          data[i][j] = `[${r}]`;
          workload[i] += roles[r - 1].workload ?? 0;
          remain[r]--;
          break;
        }
      }
    }

    // 2단계: 일반 배정 (업무강도 낮은 순)
    for (let r = 1; r <= roleCount; r++) {
      if (remain[r] <= 0) continue;

      // 해당 슬롯에 1인 교사들을 업무강도 낮은 순으로 정렬
      const candidates = [];
      for (let i = 1; i <= tCount; i++) {
        if (data[i][j] === 1 && !fixedMap[i][j]) {
          candidates.push({ i, w: workload[i] });
        }
      }
      candidates.sort((a, b) => a.w - b.w);

      let picked = 0;
      for (const { i } of candidates) {
        if (picked >= remain[r]) break;
        if (extractRole(String(data[i][j])) > 0) continue; // 이미 보직 있음
        data[i][j] = `[${r}]`;
        workload[i] += roles[r - 1].workload ?? 0;
        picked++;
      }
      remain[r] -= picked;
    }
  }

  return workload;
}

// ─── ⑤ 고사실배정 ────────────────────────────────────────────────────────────

// 고사실명에 "복도"가 포함되면 부감독(2) 역할로 간주
// ponytail: 이 매핑은 보직 인덱스 2가 부감독이라는 관례에 의존
function getRoleByRoomName(roomName, assignedRole) {
  if (roomName && roomName.includes('복도')) return 2;
  return assignedRole;
}

function assignRooms(data, fixedMap, slots, teachers, scheduleData, roles, roomRequirements, tCount, sCount) {
  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    const roleCount = roles.length;

    for (let r = 1; r <= roleCount; r++) {
      const roomPool = getRoomsForRole(roomRequirements, dayIdx, period, r);
      const shuffled = shuffle(roomPool);
      let idx = 0;

      for (let i = 1; i <= tCount; i++) {
        if (extractRole(String(data[i][j])) === r) {
          const room = shuffled[idx % shuffled.length] ?? '';
          // 복도 고사실이면 보직을 2(부감독)로 재매핑
          const actualRole = getRoleByRoomName(room, r);
          data[i][j] = `${room}[${actualRole}]`;
          idx++;
        }
      }
    }
  }
}

// ─── ⑥ 배정불가 고사실 처리 ──────────────────────────────────────────────────

function fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount) {
  const forbiddenCache = teachers.map(t => getForbiddenRooms(t));

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;

    for (let j = 1; j <= sCount; j++) {
      for (let i = 1; i <= tCount; i++) {
        const room = extractRoom(String(data[i][j]));
        const roleI = extractRole(String(data[i][j]));
        const forbidden = forbiddenCache[i - 1];

        if (!isInArray(forbidden, room)) continue;

        let swapped = false;

        // 1단계: 같은 보직, 2자 swap
        for (let k = 1; k <= tCount && !swapped; k++) {
          if (k === i) continue;
          const roleK = extractRole(String(data[k][j]));
          if (roleI !== roleK) continue;
          const roomK = extractRoom(String(data[k][j]));
          if (isInArray(forbidden, roomK)) continue;
          if (isInArray(forbiddenCache[k - 1], room)) continue;
          if (fixedMap[i][j] || fixedMap[k][j]) continue;

          data[i][j] = `${roomK}[${roleI}]`;
          data[k][j] = `${room}[${roleI}]`;
          swapped = true; changed = true;
        }

        // 2단계: 3자 순환 swap (같은 보직)
        if (!swapped) {
          outer:
          for (let jj = 1; jj <= tCount; jj++) {
            if (jj === i) continue;
            const roleJ = extractRole(String(data[jj][j]));
            if (roleI !== roleJ) continue;
            if (fixedMap[jj][j]) continue;
            const roomJ = extractRoom(String(data[jj][j]));
            const forbJ = forbiddenCache[jj - 1];

            for (let kk = jj + 1; kk <= tCount; kk++) {
              if (kk === i) continue;
              const roleK = extractRole(String(data[kk][j]));
              if (roleI !== roleK) continue;
              if (fixedMap[kk][j]) continue;
              const roomK = extractRoom(String(data[kk][j]));
              const forbK = forbiddenCache[kk - 1];

              // 회전1: i→J실, jj→K실, kk→i실
              if (!isInArray(forbidden, roomJ) && !isInArray(forbJ, roomK) && !isInArray(forbK, room)) {
                data[i][j] = `${roomJ}[${roleI}]`;
                data[jj][j] = `${roomK}[${roleI}]`;
                data[kk][j] = `${room}[${roleI}]`;
                swapped = true; changed = true; break outer;
              }
              // 회전2
              if (!isInArray(forbidden, roomK) && !isInArray(forbK, roomJ) && !isInArray(forbJ, room)) {
                data[i][j] = `${roomK}[${roleI}]`;
                data[kk][j] = `${roomJ}[${roleI}]`;
                data[jj][j] = `${room}[${roleI}]`;
                swapped = true; changed = true; break outer;
              }
            }
          }
        }

        // 3단계: 다른 보직 2자 swap (diff 1~4)
        if (!swapped) {
          for (let diff = 1; diff <= 4 && !swapped; diff++) {
            for (let k = 1; k <= tCount && !swapped; k++) {
              if (k === i) continue;
              const roleK = extractRole(String(data[k][j]));
              if (Math.abs(roleI - roleK) !== diff) continue;
              const roomK = extractRoom(String(data[k][j]));
              if (isInArray(forbidden, roomK)) continue;
              if (isInArray(forbiddenCache[k - 1], room)) continue;
              if (fixedMap[i][j] || fixedMap[k][j]) continue;

              data[i][j] = `${roomK}[${roleK}]`;
              data[k][j] = `${room}[${roleI}]`;
              swapped = true; changed = true;
            }
          }
        }
      }
    }
    if (!changed) break;
  }
}

// ─── ⑦ 업무강도 분산 ─────────────────────────────────────────────────────────

function disperseWorkload(data, fixedMap, slots, teachers, roles, tCount, sCount) {
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    let w = teachers[i - 1].prevWorkload ?? 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) w += roles[r - 1].workload ?? 0;
    }
    workload[i] = w;
  }

  // 수렴할 때까지 반복
  for (let iter = 0; iter < 200; iter++) {
    let improved = false;

    // 업무강도 내림차순 정렬
    const order = [];
    for (let i = 1; i <= tCount; i++) order.push(i);
    order.sort((a, b) => workload[b] - workload[a]);

    outer:
    for (let oi = 0; oi < order.length; oi++) {
      for (let oj = order.length - 1; oj > oi; oj--) {
        const t1 = order[oi]; // 높은 업무강도
        const t2 = order[oj]; // 낮은 업무강도
        const diff = workload[t1] - workload[t2];
        if (diff <= 0) continue;

        for (let j = 1; j <= sCount; j++) {
          const r1 = extractRole(String(data[t1][j]));
          const r2 = extractRole(String(data[t2][j]));
          if (r1 <= 0 || r2 <= 0) continue;
          if (fixedMap[t1][j] || fixedMap[t2][j]) continue;

          const w1 = roles[r1 - 1].workload ?? 0;
          const w2 = roles[r2 - 1].workload ?? 0;
          if (w1 <= w2) continue; // t1이 더 무거운 보직이어야 의미있음

          const futDiff = Math.abs((workload[t1] - w1 + w2) - (workload[t2] - w2 + w1));
          if (futDiff >= diff) continue;

          const room1 = extractRoom(String(data[t1][j]));
          const room2 = extractRoom(String(data[t2][j]));
          data[t1][j] = `${room1}[${r2}]`;
          data[t2][j] = `${room2}[${r1}]`;
          workload[t1] = workload[t1] - w1 + w2;
          workload[t2] = workload[t2] - w2 + w1;
          improved = true;
          break outer;
        }
      }
    }
    if (!improved) break;
  }

  return workload;
}

// ─── ⑧ 보직별보직수 계산 ─────────────────────────────────────────────────────

function calcRoleCounts(data, slots, teachers, roles, tCount, sCount) {
  const roleCount = roles.length;
  const result = [];
  for (let i = 1; i <= tCount; i++) {
    const counts = new Array(roleCount + 1).fill(0);
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0 && r <= roleCount) counts[r]++;
    }
    result.push({ teacherIdx: i, counts });
  }
  return result;
}

// ─── 메인 엔트리 ──────────────────────────────────────────────────────────────

/**
 * assignAll: 전체 배정 플로우
 *
 * @param {Object} input
 *   teachers: [{name, quota, prevWorkload, forbiddenRooms}]
 *   examDays: [{date, startPeriod, endPeriod}]
 *   roles: [{name, workload}]
 *   requirements: [{dayIdx, period, roleIdx, count}]   // 배정감독수정보
 *   roomRequirements: [{dayIdx, period, roleIdx, roomName, count}]  // 배정감독수정보 고사실별
 *   fixedCells: {[i][j]: true}  // 사용자 고정셀 (1-based)
 *
 * @returns {Object}
 *   data: 2D array [tCount+1][sCount+1] of string ("고사실[보직]" or "0")
 *   slots: [{dayIdx, period}]
 *   workload: [tCount+1] 최종 업무강도
 *   roleCounts: [{teacherIdx, counts}]
 *   forbiddenViolations: [{i, j}] 해소 못한 배정불가 고사실
 */
function assignAll(input) {
  const { teachers, examDays, roles, requirements, roomRequirements, fixedCells = {} } = input;

  const tCount = teachers.length;
  const slots = buildSlots(examDays);
  const sCount = slots.length;

  const maxDay = examDays.length;
  const maxPeriod = Math.max(...examDays.map(d => d.endPeriod));
  const roleCount = roles.length;

  const scheduleData = buildRequirementsArray(requirements, maxDay, maxPeriod, roleCount);

  // 슬롯별 필요 인원 (보직 합)
  const slotNeeds = new Array(sCount + 1).fill(0);
  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    slotNeeds[j] = totalTeachersForSlot(scheduleData, dayIdx, period, roleCount);
  }

  // 2D 배열 초기화 (1-based)
  const data = [];
  const fixedMap = [];
  for (let i = 0; i <= tCount; i++) {
    data[i] = new Array(sCount + 1).fill('');
    fixedMap[i] = new Array(sCount + 1).fill(false);
  }

  // 고정셀 적용
  for (const iStr of Object.keys(fixedCells)) {
    const i = parseInt(iStr);
    for (const jStr of Object.keys(fixedCells[iStr] || {})) {
      const j = parseInt(jStr);
      fixedMap[i][j] = true;
      data[i][j] = 1; // 고정셀은 배정됨으로 초기화
    }
  }

  // x(배정불가) 셀 적용
  for (let i = 1; i <= tCount; i++) {
    const xSlots = teachers[i - 1].unavailableSlots || [];
    for (const j of xSlots) {
      if (j >= 1 && j <= sCount) data[i][j] = 'x';
    }
  }

  // 반드시 들어가야 하는 시간 → 고정셀로 처리 (보직도 미리 기입)
  // teacher.requiredSlots: [{slotIdx, roleIdx}]
  for (let i = 1; i <= tCount; i++) {
    const required = teachers[i - 1].requiredSlots || [];
    for (const { slotIdx: j, roleIdx: r } of required) {
      if (j >= 1 && j <= sCount) {
        fixedMap[i][j] = true;
        data[i][j] = r > 0 ? `[${r}]` : 1; // 보직 미리 기입
      }
    }
  }

  // ① 교사 배정
  assignTeachers(data, fixedMap, slots, teachers, slotNeeds);

  // ② 날짜 분산
  disperseByDate(data, fixedMap, slots, tCount, sCount);

  // ③ 연속 감독 분산
  disperseConsecutive(data, fixedMap, slots, tCount, sCount);

  // ④ 보직 배정
  assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, tCount, sCount);

  // ⑤ 고사실 배정
  assignRooms(data, fixedMap, slots, teachers, scheduleData, roles, roomRequirements, tCount, sCount);

  // ⑥ 배정불가 고사실 처리
  fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount);

  // ⑦ 업무강도 분산
  const workload = disperseWorkload(data, fixedMap, slots, teachers, roles, tCount, sCount);

  // ⑧ 보직수 계산
  const roleCounts = calcRoleCounts(data, slots, teachers, roles, tCount, sCount);

  // 배정불가 고사실 위반 체크
  const forbiddenViolations = [];
  for (let i = 1; i <= tCount; i++) {
    const forbidden = getForbiddenRooms(teachers[i - 1]);
    for (let j = 1; j <= sCount; j++) {
      const room = extractRoom(String(data[i][j]));
      if (isInArray(forbidden, room)) forbiddenViolations.push({ i, j });
    }
  }

  return { data, slots, workload, roleCounts, forbiddenViolations };
}

/**
 * swapCells: 수동 swap (두 셀 교환)
 */
function swapCells(data, fixedMap, i1, j1, i2, j2) {
  if (fixedMap[i1][j1] || fixedMap[i2][j2]) return false;
  const tmp = data[i1][j1];
  data[i1][j1] = data[i2][j2];
  data[i2][j2] = tmp;
  return true;
}

/**
 * validateAssignment: 배정 가능 여부 사전 검증
 * returns {ok: bool, errors: [string]}
 */
function validateAssignment(teachers, slots, slotNeeds) {
  const errors = [];
  const totalQuota = teachers.reduce((s, t) => s + (t.quota ?? 0), 0);
  const totalNeed = Object.values(slotNeeds).reduce((s, v) => s + v, 0);
  if (totalQuota !== totalNeed) {
    errors.push(`배정할시간 합계(${totalQuota})와 총필요시간(${totalNeed})이 일치하지 않습니다.`);
  }
  return { ok: errors.length === 0, errors };
}

export {
  assignAll,
  swapCells,
  validateAssignment,
  buildSlots,
  buildRequirementsArray,
  extractRole,
  extractRoom,
  calcRoleCounts,
  disperseWorkload,
  parseRequirementsCSV,
};
