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

// ponytail: 입력 구분자(쉼표/세미콜론, 하이픈/언더스코어)는 관용적으로 받되 표준 출력은
//   "일차_교시" 언더스코어로 통일한다. 하이픈(-)을 쓰면 엑셀이 CSV를 열 때 날짜로 오인해버린다.
function normalizeSlotStr(str) {
  if (str == null || !String(str).trim()) return '';
  return String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean)
    .map(tok => {
      const m = tok.match(/^(\d+)[-_](\d+)$/);
      return m ? `${m[1]}_${m[2]}` : tok; // 형식이 어긋난 토큰은 그대로 둬서 사용자가 보고 고치게 함
    })
    .join(', ');
}

// ponytail: RFC4180 — 쉼표/따옴표가 있는 값만 따옴표로 감싸기 (parseCSVLine과 짝)
function csvField(v) {
  v = String(v ?? '');
  return /[,"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ponytail: 구분자(,/;)·시간형식(-/_) 모두 관용적으로 받음 (옛 데이터 호환)
function parseUnavailableSlots(str, slots) {
  if (!str || !str.trim()) return [];
  return str.split(/[,;]/).map(s => s.trim()).filter(Boolean).flatMap(token => {
    const [dayPart, periodPart] = token.split(/[-_]/);
    const dayIdx = parseInt(dayPart);
    const period = parseInt(periodPart);
    if (isNaN(dayIdx) || isNaN(period)) return [];
    const j = slots.findIndex(s => s.dayIdx === dayIdx && s.period === period) + 1;
    return j > 0 ? [j] : [];
  });
}

function parseRequiredSlots(slotStr, roleStr, slots) {
  if (!slotStr || !slotStr.trim()) return [];
  const slotTokens = slotStr.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const roleTokens = (roleStr || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return slotTokens.flatMap((token, idx) => {
    const [dayPart, periodPart] = token.split(/[-_]/);
    const dayIdx = parseInt(dayPart);
    const period = parseInt(periodPart);
    const roleIdx = parseInt(roleTokens[idx] ?? '1');
    if (isNaN(dayIdx) || isNaN(period)) return [];
    const j = slots.findIndex(s => s.dayIdx === dayIdx && s.period === period) + 1;
    return j > 0 ? [{ slotIdx: j, roleIdx: isNaN(roleIdx) ? 1 : roleIdx }] : [];
  });
}

// 더이상 존재하지 않는 고사실명을 가진 배정감독수 설정을 제거 (고사실 목록 변경 시 고아 데이터 방지)
function pruneRoomRequirements(roomRequirements, rooms) {
  const validRooms = new Set(rooms);
  return roomRequirements.filter(r => validRooms.has(r.roomName));
}

// roomRequirements(고사실별 배정감독수)를 날짜/교시/보직별 합계로 집계
function aggregateRoomRequirements(roomRequirements) {
  const map = {};
  roomRequirements.forEach(({ dayIdx, period, roleIdx, count }) => {
    const key = `${dayIdx}_${period}_${roleIdx}`;
    map[key] = (map[key] ?? 0) + count;
  });
  return Object.entries(map).map(([key, count]) => {
    const [dayIdx, period, roleIdx] = key.split('_').map(Number);
    return { dayIdx, period, roleIdx, count };
  });
}

// 자동배정 결과 그리드의 셀 1칸을 어떻게 표시할지 결정.
// 우선순위: 고정시간으로 배정된 영역(파랑) > 제외시간 x(빨강) > 기본(흰색)
// 보직별 색 구분은 안 함(인쇄 출력에서 확인) — [역할번호] 표기도 화면에는 안 보여줌(불필요한 정보).
function gridCellDisplay(cell, isFixed) {
  cell = String(cell ?? '');
  const bg = isFixed ? '#cfe3fa' : cell === 'x' ? '#fbdada' : '#fff';
  if (cell === '0' || cell === '') return { bg, text: '' };
  if (cell === 'x') return { bg, text: 'X' };
  const roleIdx = extractRole(cell);
  const room = extractRoom(cell);
  const text = roleIdx > 0 ? (room || cell) : cell;
  return { bg, text };
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

function buildSlots(examDays) {
  const slots = [];
  examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      slots.push({ dayIdx: di + 1, period: p });
    }
  });
  return slots;
}

function buildRequirementsArray(requirements, maxDay, maxPeriod, roleCount) {
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

function totalTeachersForSlot(scheduleData, dayIdx, period, roleCount) {
  let total = 0;
  for (let r = 1; r <= roleCount; r++) {
    total += (scheduleData[dayIdx]?.[period]?.[r] ?? 0);
  }
  return total;
}

function getRoomsForRole(roomRequirements, dayIdx, period, roleIdx) {
  const arr = [];
  roomRequirements
    .filter(r => r.dayIdx === dayIdx && r.period === period && r.roleIdx === roleIdx)
    .forEach(r => {
      for (let k = 0; k < r.count; k++) arr.push(r.roomName);
    });
  return arr;
}

function getForbiddenRooms(teacher) {
  const val = teacher.forbiddenRooms || '';
  if (!val.trim()) return ['__none__'];
  const parts = val.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : ['__none__'];
}

function parseRequirementsCSV(text, examDays, roles) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const header = lines[0].split(',').map(s => s.trim());
  const roomCols = header.slice(3);
  const errors = [];
  const merged = new Map();

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
      if (count <= 0) return;
      const key = `${dayIdx}\u0000${period}\u0000${roleIdx}\u0000${room}`;
      const existing = merged.get(key);
      if (existing) existing.count += count;
      else merged.set(key, { dayIdx, period, roleIdx, roomName: room, count });
    });
  });

  return { roomRequirements: [...merged.values()], errors };
}

function distributeQuota(totalNeed, maxPossible) {
  const n = maxPossible.length;
  const quota = new Array(n).fill(0);
  let total = 0, i = 0, noProgress = 0;
  while (total < totalNeed && n > 0) {
    if (quota[i] < maxPossible[i]) {
      quota[i]++;
      total++;
      noProgress = 0;
    } else {
      noProgress++;
      if (noProgress >= n) break;
    }
    i = (i + 1) % n;
  }
  return { quota, total };
}

// ─── P값 기반 배정 ────────────────────────────────────────────────────────────

function calcPValues(data, fixedMap, slots, teachers, slotNeeds) {
  const tCount = teachers.length;
  const sCount = slots.length;

  const rowP = new Array(tCount + 1).fill(-100);
  const colP = new Array(sCount + 1).fill(-100);

  for (let i = 1; i <= tCount; i++) {
    const quota = teachers[i - 1].quota ?? 0;
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

  for (let i = 1; i <= tCount; i++) {
    if (rowP[i] > maxVal && rowP[i] <= 1) {
      maxVal = rowP[i];
      maxIdx = i - 1;
    }
  }
  for (let j = 1; j <= sCount; j++) {
    if (colP[j] > maxVal && colP[j] <= 1) {
      maxVal = colP[j];
      maxIdx = tCount + j - 1;
    }
  }
  return { maxIdx, maxVal };
}

function insertOneInRow(data, fixedMap, rowIdx, colP, sCount) {
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
  for (let i = 1; i <= tCount; i++) {
    if (rowP[i] <= 0) continue;
    for (let j = 1; j <= sCount; j++) {
      if (data[i][j] !== '' && data[i][j] !== 0) continue;
      if (fixedMap[i][j]) continue;
      for (let k = 1; k <= tCount; k++) {
        if (k === i) continue;
        if (data[k][j] === 1 && !fixedMap[k][j] && rowP[k] < 0) {
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

          for (let j1 = 1; j1 <= sCount; j1++) {
            if (slots[j1 - 1].dayIdx !== highDay) continue;
            if (data[i][j1] !== 1 || fixedMap[i][j1]) continue;

            for (let k = 1; k <= tCount; k++) {
              if (k === i) continue;
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
  const map = {};
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
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    workload[i] = teachers[i - 1].prevWorkload ?? 0;
  }

  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    const roleCount = roles.length;

    const remain = new Array(roleCount + 1).fill(0);
    for (let r = 1; r <= roleCount; r++) {
      remain[r] = scheduleData[dayIdx]?.[period]?.[r] ?? 0;
    }

    // 0단계: 사전 배정된 보직 인원 차감
    // ponytail: 빠뜨리면 같은 보직 정원에서 한 명을 안 빼고 시작해서 중복 배정 → 미배정 버그
    for (let i = 1; i <= tCount; i++) {
      const preRole = extractRole(String(data[i][j]));
      if (preRole > 0) {
        workload[i] += roles[preRole - 1].workload ?? 0;
        if (remain[preRole] > 0) remain[preRole]--;
      }
    }

    // 1단계: 고정셀(보직 미정, data===1) 먼저
    for (let i = 1; i <= tCount; i++) {
      if (!fixedMap[i][j] || data[i][j] !== 1) continue;
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
        if (extractRole(String(data[i][j])) > 0) continue;
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

function getRoleByRoomName(roomName, assignedRole) {
  if (roomName && roomName.includes('복도')) return 2;
  return assignedRole;
}

function assignRooms(data, fixedMap, slots, teachers, scheduleData, roles, roomRequirements, tCount, sCount) {
  const roomShortages = [];

  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    const roleCount = roles.length;

    for (let r = 1; r <= roleCount; r++) {
      const roomPool = getRoomsForRole(roomRequirements, dayIdx, period, r);
      const shuffled = shuffle(roomPool);
      let idx = 0;

      for (let i = 1; i <= tCount; i++) {
        if (extractRole(String(data[i][j])) === r) {
          if (idx < shuffled.length) {
            const room = shuffled[idx];
            const actualRole = getRoleByRoomName(room, r);
            data[i][j] = `${room}[${actualRole}]`;
          } else {
            data[i][j] = `미배정[${r}]`;
            roomShortages.push({ i, j, roleIdx: r });
          }
          idx++;
        }
      }
    }
  }

  return roomShortages;
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

              if (!isInArray(forbidden, roomJ) && !isInArray(forbJ, roomK) && !isInArray(forbK, room)) {
                data[i][j] = `${roomJ}[${roleI}]`;
                data[jj][j] = `${roomK}[${roleI}]`;
                data[kk][j] = `${room}[${roleI}]`;
                swapped = true; changed = true; break outer;
              }
              if (!isInArray(forbidden, roomK) && !isInArray(forbK, roomJ) && !isInArray(forbJ, room)) {
                data[i][j] = `${roomK}[${roleI}]`;
                data[kk][j] = `${roomJ}[${roleI}]`;
                data[jj][j] = `${room}[${roleI}]`;
                swapped = true; changed = true; break outer;
              }
            }
          }
        }

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

  for (let iter = 0; iter < 200; iter++) {
    let improved = false;

    const order = [];
    for (let i = 1; i <= tCount; i++) order.push(i);
    order.sort((a, b) => workload[b] - workload[a]);

    outer:
    for (let oi = 0; oi < order.length; oi++) {
      for (let oj = order.length - 1; oj > oi; oj--) {
        const t1 = order[oi];
        const t2 = order[oj];
        const diff = workload[t1] - workload[t2];
        if (diff <= 0) continue;

        for (let j = 1; j <= sCount; j++) {
          const r1 = extractRole(String(data[t1][j]));
          const r2 = extractRole(String(data[t2][j]));
          if (r1 <= 0 || r2 <= 0) continue;
          if (fixedMap[t1][j] || fixedMap[t2][j]) continue;

          const w1 = roles[r1 - 1].workload ?? 0;
          const w2 = roles[r2 - 1].workload ?? 0;
          if (w1 <= w2) continue;

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

function assignAll(input) {
  const { teachers, examDays, roles, requirements, roomRequirements, fixedCells = {} } = input;

  const tCount = teachers.length;
  const slots = buildSlots(examDays);
  const sCount = slots.length;

  const maxDay = examDays.length;
  const maxPeriod = Math.max(...examDays.map(d => d.endPeriod));
  const roleCount = roles.length;

  const scheduleData = buildRequirementsArray(requirements, maxDay, maxPeriod, roleCount);

  const slotNeeds = new Array(sCount + 1).fill(0);
  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];
    slotNeeds[j] = totalTeachersForSlot(scheduleData, dayIdx, period, roleCount);
  }

  const data = [];
  const fixedMap = [];
  for (let i = 0; i <= tCount; i++) {
    data[i] = new Array(sCount + 1).fill('');
    fixedMap[i] = new Array(sCount + 1).fill(false);
  }

  for (const iStr of Object.keys(fixedCells)) {
    const i = parseInt(iStr);
    for (const jStr of Object.keys(fixedCells[iStr] || {})) {
      const j = parseInt(jStr);
      fixedMap[i][j] = true;
      data[i][j] = 1;
    }
  }

  for (let i = 1; i <= tCount; i++) {
    const xSlots = teachers[i - 1].unavailableSlots || [];
    for (const j of xSlots) {
      if (j >= 1 && j <= sCount) data[i][j] = 'x';
    }
  }

  for (let i = 1; i <= tCount; i++) {
    const required = teachers[i - 1].requiredSlots || [];
    for (const { slotIdx: j, roleIdx: r } of required) {
      if (j >= 1 && j <= sCount) {
        fixedMap[i][j] = true;
        data[i][j] = r > 0 ? `[${r}]` : 1;
      }
    }
  }

  assignTeachers(data, fixedMap, slots, teachers, slotNeeds);
  disperseByDate(data, fixedMap, slots, tCount, sCount);
  disperseConsecutive(data, fixedMap, slots, tCount, sCount);
  assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, tCount, sCount);
  const roomShortages = assignRooms(data, fixedMap, slots, teachers, scheduleData, roles, roomRequirements, tCount, sCount);
  fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount);
  const workload = disperseWorkload(data, fixedMap, slots, teachers, roles, tCount, sCount);
  const roleCounts = calcRoleCounts(data, slots, teachers, roles, tCount, sCount);

  const forbiddenViolations = [];
  for (let i = 1; i <= tCount; i++) {
    const forbidden = getForbiddenRooms(teachers[i - 1]);
    for (let j = 1; j <= sCount; j++) {
      const room = extractRoom(String(data[i][j]));
      if (isInArray(forbidden, room)) forbiddenViolations.push({ i, j });
    }
  }

  return { data, slots, workload, roleCounts, forbiddenViolations, roomShortages };
}

function swapCells(data, fixedMap, i1, j1, i2, j2) {
  if (fixedMap[i1][j1] || fixedMap[i2][j2]) return false;
  const tmp = data[i1][j1];
  data[i1][j1] = data[i2][j2];
  data[i2][j2] = tmp;
  return true;
}

function validateAssignment(teachers, slots, slotNeeds) {
  const errors = [];
  const totalQuota = teachers.reduce((s, t) => s + (t.quota ?? 0), 0);
  const totalNeed = Object.values(slotNeeds).reduce((s, v) => s + v, 0);
  if (totalQuota !== totalNeed) {
    errors.push(`배정시간 합계(${totalQuota})와 총필요시간(${totalNeed})이 일치하지 않습니다.`);
  }
  return { ok: errors.length === 0, errors };
}

function buildSaveSnapshot(state) {
  return {
    teachers: state.teachers,
    rooms: state.rooms,
    roles: state.roles,
    examDays: state.examDays,
    requirements: state.requirements,
    roomRequirements: state.roomRequirements,
    assignment: state.data ? {
      data: state.data,
      fixedCells: state.fixedCells,
      workload: state.workload,
      roleCounts: state.roleCounts,
      slots: state.slots,
    } : null,
  };
}

function applySnapshotToState(snapshot) {
  const a = snapshot.assignment;
  return {
    teachers: snapshot.teachers ?? [],
    rooms: snapshot.rooms ?? [],
    roles: snapshot.roles ?? [],
    examDays: snapshot.examDays ?? [],
    requirements: snapshot.requirements ?? [],
    roomRequirements: snapshot.roomRequirements ?? [],
    data: a?.data ?? null,
    fixedCells: a?.fixedCells ?? {},
    workload: a?.workload ?? [],
    roleCounts: a?.roleCounts ?? [],
    slots: a?.slots ?? [],
  };
}

function emptyState() {
  return {
    teachers: [], rooms: [], roles: [], examDays: [],
    requirements: [], roomRequirements: [],
    data: null, fixedCells: {}, workload: [], roleCounts: [], slots: [],
  };
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
  distributeQuota,
  assignRooms,
  assignRoles,
  buildSaveSnapshot,
  applySnapshotToState,
  emptyState,
  csvField,
  gridCellDisplay,
  normalizeSlotStr,
  parseUnavailableSlots,
  parseRequiredSlots,
  pruneRoomRequirements,
  aggregateRoomRequirements,
};
