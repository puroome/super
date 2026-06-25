// algorithm.js — 시험감독 자동배정 알고리즘

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

function normalizeSlotStr(str) {
  if (str == null || !String(str).trim()) return '';
  return String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean)
    .map(tok => {
      // 새 표준: 12 = 1일차 2교시. 예전 1_2 / 1-2 입력도 12로 변환.
      const m = tok.match(/^(\d+)[-_](\d+)$/);
      return m ? `${m[1]}${m[2]}` : tok.replace(/\s+/g, '');
    })
    .join(', ');
}

function splitList(str) {
  return String(str ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function findSlotIndex(slots, dayIdx, period) {
  return slots.findIndex(s => s.dayIdx === dayIdx && s.period === period) + 1;
}

function parseSlotToken(token, slots) {
  const normalized = normalizeSlotStr(token);
  if (!/^\d{2,}$/.test(normalized)) return null;

  // ponytail: 12는 1일차 2교시. 혹시 10일차처럼 두 자리 일차가 생겨도
  // slots에 실제 존재하는 분할을 찾아서 처리한다.
  for (let cut = 1; cut < normalized.length; cut++) {
    const dayIdx = parseInt(normalized.slice(0, cut), 10);
    const period = parseInt(normalized.slice(cut), 10);
    const slotIdx = findSlotIndex(slots, dayIdx, period);
    if (slotIdx > 0) return { dayIdx, period, slotIdx };
  }
  return null;
}

function csvField(v) {
  v = String(v ?? '');
  return /[,"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function parseUnavailableSlots(str, slots) {
  if (!str || !str.trim()) return [];
  const out = [];
  for (const token of splitList(str)) {
    const normalized = normalizeSlotStr(token);

    // 제외시간 한 자리 숫자 = 해당 일차 전체 제외
    if (/^\d$/.test(normalized)) {
      const dayIdx = parseInt(normalized, 10);
      slots.forEach((s, idx) => { if (s.dayIdx === dayIdx) out.push(idx + 1); });
      continue;
    }

    const parsed = parseSlotToken(normalized, slots);
    if (parsed) out.push(parsed.slotIdx);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function parseRequiredSlots(slotStr, roleStr, slots) {
  if (!slotStr || !slotStr.trim()) return [];
  const slotTokens = splitList(slotStr);
  const roleTokens = splitList(roleStr || '');
  return slotTokens.flatMap((token, idx) => {
    const parsed = parseSlotToken(token, slots);
    if (!parsed) return [];
    const roleIdx = parseInt(roleTokens[idx] ?? '1', 10);
    return [{ slotIdx: parsed.slotIdx, roleIdx: isNaN(roleIdx) ? 1 : roleIdx }];
  });
}

function pruneRoomRequirements(roomRequirements, rooms) {
  const validRooms = new Set(rooms);
  return roomRequirements.filter(r => validRooms.has(r.roomName));
}

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

function removeRoleFromRequirements(roomRequirements, removedRoleIdx) {
  return roomRequirements
    .filter(r => r.roleIdx !== removedRoleIdx)
    .map(r => r.roleIdx > removedRoleIdx ? { ...r, roleIdx: r.roleIdx - 1 } : r);
}

function removeDayFromRequirements(roomRequirements, removedDayIdx) {
  return roomRequirements
    .filter(r => r.dayIdx !== removedDayIdx)
    .map(r => r.dayIdx > removedDayIdx ? { ...r, dayIdx: r.dayIdx - 1 } : r);
}

function gridCellDisplay(cell, isFixed, isManualFixed) {
  cell = String(cell ?? '');
  const bg = isManualFixed ? '#c8c8c8' : isFixed ? '#cfe3fa' : cell === 'x' ? '#fbdada' : '#fff';
  if (cell === '0' || cell === '') return { bg, text: '' };
  if (cell === 'x') return { bg, text: 'X' };
  const roleIdx = extractRole(cell);
  const room = extractRoom(cell);
  const text = roleIdx > 0 ? room : cell;
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

// ─── 핵심 배정 로직: 업무강도 기반 전체 최적화 ───────────────────────────────

// ponytail: 그리디 최적화 — 매 슬롯×보직마다 (이전누적강도 + 현재누적강도)가 가장 낮은
//   교사에게 배정. 연속감독 최대 2교시 제한(불가피한 경우 제외).
//   O(슬롯수 × 보직수 × 교사수) — 교사/슬롯 수가 수백 이하면 충분히 빠름.

function buildDaySlotMap(slots, sCount) {
  const map = {};
  for (let j = 1; j <= sCount; j++) {
    const d = slots[j - 1].dayIdx;
    if (!map[d]) map[d] = [];
    map[d].push(j);
  }
  return map;
}

// 해당 교사가 슬롯 j를 배정받으면 연속 3교시 이상이 되는지 확인
function wouldExceedConsecutive(data, teacherIdx, j, slots, daySlotMap) {
  const dayIdx = slots[j - 1].dayIdx;
  const dayCols = daySlotMap[dayIdx] ?? [];
  const pos = dayCols.indexOf(j);
  if (pos < 0) return false;

  // j 앞뒤 연속 배정 수 계산
  let before = 0;
  for (let k = pos - 1; k >= 0; k--) {
    const v = data[teacherIdx][dayCols[k]];
    if (v === 1 || extractRole(String(v)) > 0) before++;
    else break;
  }
  let after = 0;
  for (let k = pos + 1; k < dayCols.length; k++) {
    const v = data[teacherIdx][dayCols[k]];
    if (v === 1 || extractRole(String(v)) > 0) after++;
    else break;
  }
  return before + 1 + after > 2;
}

function assignAll(input) {
  const { teachers, examDays, roles, requirements, roomRequirements, fixedCells = {} } = input;

  const tCount = teachers.length;
  const slots = buildSlots(examDays);
  const sCount = slots.length;

  const maxDay = examDays.length;
  const maxPeriod = Math.max(...examDays.map(d => d.endPeriod));
  const roleCount = roles.length;

  const scheduleData = buildRequirementsArray(requirements, maxDay, maxPeriod, roleCount);
  const daySlotMap = buildDaySlotMap(slots, sCount);

  // data[i][j]: '' = 미배정, 'x' = 제외, 1 = 배정확정(보직미정), '[r]' = 보직확정, 'room[r]' = 완료
  const data = [];
  const fixedMap = [];
  for (let i = 0; i <= tCount; i++) {
    data[i] = new Array(sCount + 1).fill('');
    fixedMap[i] = new Array(sCount + 1).fill(false);
  }

  // 1단계: 더블클릭 수동고정 복원 (data는 1로, assignRooms 후 고사실 복원)
  for (const iStr of Object.keys(fixedCells)) {
    const i = parseInt(iStr);
    for (const jStr of Object.keys(fixedCells[iStr] || {})) {
      const j = parseInt(jStr);
      fixedMap[i][j] = true;
      data[i][j] = 1;
    }
  }

  // 2단계: 제외 시간 마킹
  for (let i = 1; i <= tCount; i++) {
    const xSlots = teachers[i - 1].unavailableSlots || [];
    for (const j of xSlots) {
      if (j >= 1 && j <= sCount) data[i][j] = 'x';
    }
  }

  // 3단계: 기본정보 고정시간 확정 (fixedCells보다 우선하지 않음)
  for (let i = 1; i <= tCount; i++) {
    const required = teachers[i - 1].requiredSlots || [];
    for (const { slotIdx: j, roleIdx: r } of required) {
      if (j >= 1 && j <= sCount) {
        fixedMap[i][j] = true;
        // ponytail: fixedCells(더블클릭)가 이미 값을 가지면 덮어쓰지 않음
        const cv = fixedCells[i]?.[j];
        if (!cv || cv === true) data[i][j] = r > 0 ? `[${r}]` : 1;
      }
    }
  }

  // ── 공통 카운터/헬퍼 ─────────────────────────────────────────────────────

  // workload 초기화 (이전누적강도 + 고정셀 강도)
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    workload[i] = teachers[i - 1].prevWorkload ?? 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) workload[i] += roles[r - 1]?.workload ?? 0;
    }
  }

  // 보직 미정 수동고정셀은 먼저 보직을 확정해야 남은 정원을 정확히 계산할 수 있음
  assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, workload, tCount, sCount);

  // 감독 횟수 카운터 — 총 감독수는 모든 보직, 정/부 비율은 1·2번 보직만 별도 집계
  const supCount = new Array(tCount + 1).fill(0);
  const roleCount1 = new Array(tCount + 1).fill(0); // 정감독 횟수
  const roleCount2 = new Array(tCount + 1).fill(0); // 부감독 횟수
  const recountTeacher = (i) => {
    supCount[i] = 0;
    roleCount1[i] = 0;
    roleCount2[i] = 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) supCount[i]++;
      if (r === 1) roleCount1[i]++;
      if (r === 2) roleCount2[i]++;
    }
  };
  for (let i = 1; i <= tCount; i++) recountTeacher(i);

  // 예외교사 판별: 이름 텍스트에 괄호가 있으면 예외교사
  // ponytail: 전각 괄호도 같이 처리 — 이름 표시 방식이 조금 달라도 같은 규칙 적용
  const isException = new Array(tCount + 1).fill(false);
  for (let i = 1; i <= tCount; i++) {
    if (/[()（）]/.test(teachers[i - 1].name || '')) isException[i] = true;
  }

  // 슬롯 j에서 보직 r의 남은 정원
  const remainForSlot = (j, r) => {
    const { dayIdx, period } = slots[j - 1];
    const need = scheduleData[dayIdx]?.[period]?.[r] ?? 0;
    let filled = 0;
    for (let i = 1; i <= tCount; i++) if (extractRole(String(data[i][j])) === r) filled++;
    return Math.max(0, need - filled);
  };

  const remainingByRoleForSlot = (j) => {
    const arr = new Array(roleCount + 1).fill(0);
    for (let r = 1; r <= roleCount; r++) arr[r] = remainForSlot(j, r);
    return arr;
  };

  const totalRemainingForSlot = (j) => {
    let total = 0;
    for (let r = 1; r <= roleCount; r++) total += remainForSlot(j, r);
    return total;
  };

  const isAssignableCell = (i, j) => (data[i][j] === '' || data[i][j] === 0) && !fixedMap[i][j];

  const putRole = (i, j, r) => {
    data[i][j] = `[${r}]`;
    workload[i] += roles[r - 1]?.workload ?? 0;
    supCount[i]++;
    if (r === 1) roleCount1[i]++;
    if (r === 2) roleCount2[i]++;
  };

  const compareTuple = (a, b) => {
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      if (a[k] < b[k]) return -1;
      if (a[k] > b[k]) return 1;
    }
    return 0;
  };

  // ── A. 예외교사 선배정: 가능한 슬롯은 부감독(r=2)으로 먼저 채움 ──
  // 3연속 감독은 예외 없이 금지. 부감독 보직이 없거나 정원이 없으면 배정하지 않음.
  if (roleCount >= 2) {
    for (let j = 1; j <= sCount; j++) {
      let left = remainForSlot(j, 2);
      if (left <= 0) continue;

      const candidates = [];
      for (let i = 1; i <= tCount; i++) {
        if (!isException[i]) continue;
        if (!isAssignableCell(i, j)) continue;
        if (wouldExceedConsecutive(data, i, j, slots, daySlotMap)) continue;
        candidates.push(i);
      }

      const ordered = shuffle(candidates).sort((a, b) => compareTuple(
        [supCount[a], workload[a]],
        [supCount[b], workload[b]],
      ));

      for (const i of ordered) {
        if (left <= 0) break;
        putRole(i, j, 2);
        left--;
      }
    }
  }

  // ── B. 일반교사 목표치 계산 ────────────────────────────────────────────────
  const regulars = [];
  for (let i = 1; i <= tCount; i++) if (!isException[i]) regulars.push(i);

  let remNeed1 = 0, remNeed2 = 0, totalRemNeed = 0;
  for (let j = 1; j <= sCount; j++) {
    for (let r = 1; r <= roleCount; r++) {
      const left = remainForSlot(j, r);
      totalRemNeed += left;
      if (r === 1) remNeed1 += left;
      if (r === 2) remNeed2 += left;
    }
  }

  let currentRegular1 = 0, currentRegular2 = 0, currentRegularTotal = 0;
  for (const i of regulars) {
    currentRegular1 += roleCount1[i];
    currentRegular2 += roleCount2[i];
    currentRegularTotal += supCount[i];
  }

  const ratioDenom = currentRegular1 + currentRegular2 + remNeed1 + remNeed2;
  const targetRatio1 = ratioDenom > 0 ? (currentRegular1 + remNeed1) / ratioDenom : 0.5;

  // 교사별 가능한 추가 감독 슬롯 수. 불가 시간이 많은 교사는 capacity가 낮아지고,
  // 목표치가 capacity까지 내려가므로 가능한 슬롯에서는 우선도가 높아진다.
  const capacityFinal = new Array(tCount + 1).fill(0);
  for (const i of regulars) {
    let extra = 0;
    for (let j = 1; j <= sCount; j++) {
      if (totalRemainingForSlot(j) <= 0) continue;
      if (!isAssignableCell(i, j)) continue;
      if (wouldExceedConsecutive(data, i, j, slots, daySlotMap)) continue;
      extra++;
    }
    capacityFinal[i] = supCount[i] + extra;
  }

  const calcFairTargets = () => {
    const targets = new Array(tCount + 1).fill(0);
    for (const i of regulars) targets[i] = supCount[i];
    if (!regulars.length) return targets;

    const desiredTotal = Math.min(
      currentRegularTotal + totalRemNeed,
      regulars.reduce((sum, i) => sum + capacityFinal[i], 0),
    );

    let lo = Math.min(...regulars.map(i => supCount[i]));
    let hi = Math.max(...regulars.map(i => Math.max(supCount[i], capacityFinal[i])));

    for (let iter = 0; iter < 60; iter++) {
      const mid = (lo + hi) / 2;
      const sum = regulars.reduce((acc, i) => acc + Math.min(capacityFinal[i], Math.max(supCount[i], mid)), 0);
      if (sum < desiredTotal) lo = mid;
      else hi = mid;
    }

    for (const i of regulars) {
      targets[i] = Math.min(capacityFinal[i], Math.max(supCount[i], hi));
    }
    return targets;
  };

  const targetTotal = calcFairTargets();

  const ratioScoreAfter = (i, r) => {
    const c1 = roleCount1[i] + (r === 1 ? 1 : 0);
    const c2 = roleCount2[i] + (r === 2 ? 1 : 0);
    const denom = c1 + c2;
    if (denom <= 0) return 0;
    // 정/부가 아닌 보직은 비율을 직접 바꾸지 않으므로 아주 작은 후순위 패널티만 둔다.
    const neutralPenalty = (r === 1 || r === 2) ? 0 : 0.05;
    return Math.abs((c1 / denom) - targetRatio1) + neutralPenalty;
  };

  const scoreAssignment = (i, r) => {
    const target = Math.max(targetTotal[i], 1);
    const progress = supCount[i] / target;       // 1순위: 목표 감독수 대비 현재 진행률
    const rawCount = supCount[i];                // 같은 진행률이면 실제 감독수가 적은 교사 우선
    const ratio = ratioScoreAfter(i, r);         // 2순위: 정/부 비율 목표와의 거리
    const w = workload[i] + (roles[r - 1]?.workload ?? 0); // 3순위: 누적강도
    return [progress, rawCount, ratio, w, Math.random()];
  };

  // ── C. 일반교사 배정: 총횟수 → 정/부 비율 → 누적강도 순으로 좌석 하나씩 선택 ──
  for (let j = 1; j <= sCount; j++) {
    const remain = remainingByRoleForSlot(j);

    while (remain.reduce((sum, v) => sum + v, 0) > 0) {
      let best = null;

      for (const i of regulars) {
        if (!isAssignableCell(i, j)) continue;
        if (wouldExceedConsecutive(data, i, j, slots, daySlotMap)) continue;

        for (let r = 1; r <= roleCount; r++) {
          if (remain[r] <= 0) continue;
          const score = scoreAssignment(i, r);
          if (!best || compareTuple(score, best.score) < 0) best = { i, r, score };
        }
      }

      if (!best) break; // 3연속 제한/불가시간 때문에 더 이상 안전하게 채울 수 없는 슬롯

      putRole(best.i, j, best.r);
      remain[best.r]--;
    }
  }

  // 5단계: 혹시 남은 보직 미정 고정셀 처리
  assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, workload, tCount, sCount);

  // 6단계: 고사실배정
  const roomShortages = assignRooms(data, fixedMap, slots, teachers, scheduleData, roles, roomRequirements, tCount, sCount);

  // 7단계: 더블클릭 고정 셀 고사실 복원
  for (const iStr of Object.keys(fixedCells)) {
    const i = parseInt(iStr);
    for (const jStr of Object.keys(fixedCells[iStr] || {})) {
      const j = parseInt(jStr);
      const cv = fixedCells[iStr][jStr];
      if (cv && cv !== true && extractRoom(String(cv)) && !String(cv).startsWith('[')) {
        data[i][j] = cv;
      }
    }
  }

  // 8단계: 제외 고사실 처리 — 예외교사는 부감독 보직이 유지되도록 보호
  fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount, isException);

  // 9단계: 업무강도 분산 — 총횟수와 정/부 비율을 해치지 않는 교환만 허용
  const finalWorkload = disperseWorkload(data, fixedMap, slots, teachers, roles, tCount, sCount, isException, targetRatio1);

  const roleCounts = calcRoleCounts(data, slots, teachers, roles, tCount, sCount);

  const forbiddenViolations = [];
  for (let i = 1; i <= tCount; i++) {
    const forbidden = getForbiddenRooms(teachers[i - 1]);
    for (let j = 1; j <= sCount; j++) {
      const room = extractRoom(String(data[i][j]));
      if (isInArray(forbidden, room)) forbiddenViolations.push({ i, j });
    }
  }

  return { data, slots, workload: finalWorkload, roleCounts, forbiddenViolations, roomShortages };
}

// ─── 업무강도 분산 ───────────────────────────────────────────────────────────
// ponytail: 고사실 배정 완료 후 같은 슬롯의 두 교사 보직을 교환해 강도 편차를 줄임.
//   VBA 원본 업무분산시작()과 동일한 로직. 최대 200회 반복으로 수렴 보장.

function disperseWorkload(data, fixedMap, slots, teachers, roles, tCount, sCount, isException = [], targetRatio1 = 0.5) {
  const workload = new Array(tCount + 1).fill(0);
  const c1 = new Array(tCount + 1).fill(0);
  const c2 = new Array(tCount + 1).fill(0);

  for (let i = 1; i <= tCount; i++) {
    let w = teachers[i - 1].prevWorkload ?? 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) w += roles[r - 1]?.workload ?? 0;
      if (r === 1) c1[i]++;
      if (r === 2) c2[i]++;
    }
    workload[i] = w;
  }

  const ratioDev = (one, two) => {
    const denom = one + two;
    return denom > 0 ? Math.abs((one / denom) - targetRatio1) : 0;
  };

  const nextCountsAfterSwap = (i, outRole, inRole) => {
    let n1 = c1[i], n2 = c2[i];
    if (outRole === 1) n1--;
    if (outRole === 2) n2--;
    if (inRole === 1) n1++;
    if (inRole === 2) n2++;
    return [n1, n2];
  };

  for (let iter = 0; iter < 200; iter++) {
    let improved = false;
    const order = [];
    for (let i = 1; i <= tCount; i++) {
      if (!isException[i]) order.push(i);
    }
    order.sort((a, b) => workload[b] - workload[a]);

    outer:
    for (let oi = 0; oi < order.length; oi++) {
      for (let oj = order.length - 1; oj > oi; oj--) {
        const t1 = order[oi];  // 강도 높음
        const t2 = order[oj];  // 강도 낮음
        const diff = workload[t1] - workload[t2];
        if (diff <= 0) continue;

        for (let j = 1; j <= sCount; j++) {
          const r1 = extractRole(String(data[t1][j]));
          const r2 = extractRole(String(data[t2][j]));
          if (r1 <= 0 || r2 <= 0 || r1 === r2) continue;
          if (fixedMap[t1][j] || fixedMap[t2][j]) continue;

          const w1 = roles[r1 - 1]?.workload ?? 0;
          const w2 = roles[r2 - 1]?.workload ?? 0;
          if (w1 <= w2) continue;  // t1이 이미 가벼운 보직이면 교환 의미 없음

          const futDiff = Math.abs((workload[t1] - w1 + w2) - (workload[t2] - w2 + w1));
          if (futDiff >= diff) continue;  // 교환해도 개선 안 됨

          // 2순위인 정/부 비율을 해치는 업무강도 교환은 하지 않음
          const beforeRatio = ratioDev(c1[t1], c2[t1]) + ratioDev(c1[t2], c2[t2]);
          const [t1n1, t1n2] = nextCountsAfterSwap(t1, r1, r2);
          const [t2n1, t2n2] = nextCountsAfterSwap(t2, r2, r1);
          const afterRatio = ratioDev(t1n1, t1n2) + ratioDev(t2n1, t2n2);
          if (afterRatio > beforeRatio + 1e-9) continue;

          const room1 = extractRoom(String(data[t1][j]));
          const room2 = extractRoom(String(data[t2][j]));
          data[t1][j] = `${room1}[${r2}]`;
          data[t2][j] = `${room2}[${r1}]`;
          workload[t1] = workload[t1] - w1 + w2;
          workload[t2] = workload[t2] - w2 + w1;
          c1[t1] = t1n1; c2[t1] = t1n2;
          c1[t2] = t2n1; c2[t2] = t2n2;
          improved = true;
          break outer;
        }
      }
    }
    if (!improved) break;
  }

  return workload;
}

// ─── 보직배정 ────────────────────────────────────────────────────────────────
// ponytail: 4단계에서 일반 배정은 [r] 직접 확정했으므로 여기선 고정셀(data===1)만 처리

function assignRoles(data, fixedMap, slots, teachers, scheduleData, roles, workload, tCount, sCount) {
  const roleCount = roles.length;

  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];

    const remain = new Array(roleCount + 1).fill(0);
    for (let r = 1; r <= roleCount; r++) {
      remain[r] = scheduleData[dayIdx]?.[period]?.[r] ?? 0;
    }

    // 이미 보직 확정된 셀 차감
    for (let i = 1; i <= tCount; i++) {
      const preRole = extractRole(String(data[i][j]));
      if (preRole > 0 && remain[preRole] > 0) remain[preRole]--;
    }

    // 고정셀 중 보직 미정(data===1)만 배정 — 강도 낮은 보직 순
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
  }
}

// ─── 고사실배정 ──────────────────────────────────────────────────────────────

function getRoleByRoomName(roomName, assignedRole) {
  // ponytail: 고사실 이름에 '복도'가 들어가도 보직은 바꾸지 않는다.
  // 보직은 배정설정에서 요구한 roleIdx 그대로 유지해야 감독표 탭에서 누락되지 않는다.
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
          // ponytail: 고정 셀이 이미 고사실 정보를 갖고 있으면 건너뜀 (idx 증가 없음)
          if (fixedMap[i][j] && extractRoom(String(data[i][j])).length > 0 && !String(data[i][j]).startsWith('[')) continue;
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

// ─── 배정불가 고사실 처리 ────────────────────────────────────────────────────

function fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount, isException = []) {
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

        // 1) 같은 보직끼리 고사실만 교환 — 예외교사의 부감독 보직도 유지됨
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

        // 2) 같은 보직 3자 순환
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

        // 3) 다른 보직과 교환은 최후 수단. 단, 예외교사는 부감독 보직을 절대 바꾸지 않음.
        if (!swapped && !isException[i]) {
          for (let diff = 1; diff <= 4 && !swapped; diff++) {
            for (let k = 1; k <= tCount && !swapped; k++) {
              if (k === i || isException[k]) continue;
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


function calcWorkload(data, teachers, roles, tCount, sCount) {
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    let w = teachers[i - 1]?.prevWorkload ?? 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i]?.[j] ?? ''));
      if (r > 0) w += roles[r - 1]?.workload ?? 0;
    }
    workload[i] = w;
  }
  return workload;
}

// ─── 보직별 카운트 계산 ───────────────────────────────────────────────────────

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

// ─── swap / validate ─────────────────────────────────────────────────────────

function swapCells(data, fixedMap, i1, j1, i2, j2) {
  if (fixedMap[i1]?.[j1] || fixedMap[i2]?.[j2]) return false;
  const tmp = data[i1][j1];
  data[i1][j1] = data[i2][j2];
  data[i2][j2] = tmp;
  return true;
}

function validateAssignment(slots, requirements) {
  // ponytail: quota 개념 제거 — 배정설정(requirements)이 비어있는지만 확인
  if (!requirements || requirements.length === 0) {
    return { ok: false, errors: ['배정설정 탭에서 고사실별 필요인원을 먼저 입력하세요.'] };
  }
  return { ok: true, errors: [] };
}

// ─── 탭 위계 잠금 ────────────────────────────────────────────────────────────
// 이전 단계 데이터가 없으면 다음 탭을 잠근다. UI(DOM)는 모르는 순수 함수라 테스트하기 쉽다.
function computeTabLocks(state) {
  const hasBasic = state.teachers.length > 0 && state.rooms.length > 0 && state.examDays.length > 0;
  const hasReq = state.roomRequirements.length > 0;
  const hasAssign = !!state.data;
  return {
    'tab-req': !hasBasic,
    'tab-assign': !(hasBasic && hasReq),
    'tab-table': !(hasBasic && hasReq && hasAssign),
  };
}

// ─── 스냅샷 ──────────────────────────────────────────────────────────────────

function buildSaveSnapshot(state) {
  return {
    teachers: state.teachers,
    rooms: state.rooms,
    roomMeta: state.roomMeta ?? [],
    roles: state.roles,
    examDays: state.examDays,
    requirements: state.requirements,
    roomRequirements: state.roomRequirements,
    excludedCells: state.excludedCells ?? {},
    preFixed: state.preFixed ?? {},
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
  const rooms = snapshot.rooms ?? [];
  return {
    teachers: snapshot.teachers ?? [],
    rooms,
    roomMeta: snapshot.roomMeta ?? rooms.map(name => ({ name, grade: null, isAssistant: false })),
    roles: snapshot.roles ?? [],
    examDays: snapshot.examDays ?? [],
    requirements: snapshot.requirements ?? [],
    roomRequirements: snapshot.roomRequirements ?? [],
    excludedCells: snapshot.excludedCells ?? {},
    preFixed: snapshot.preFixed ?? {},
    data: a?.data ?? null,
    fixedCells: a?.fixedCells ?? {},
    workload: a?.workload ?? [],
    roleCounts: a?.roleCounts ?? [],
    slots: a?.slots ?? [],
  };
}

function emptyState() {
  return {
    teachers: [], rooms: [], roomMeta: [],
    roles: [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50, active: true }],
    examDays: [],
    requirements: [], roomRequirements: [],
    excludedCells: {}, preFixed: {},
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
  calcWorkload,
  parseRequirementsCSV,
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
  removeRoleFromRequirements,
  removeDayFromRequirements,
  computeTabLocks,
};
