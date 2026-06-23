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
      const m = tok.match(/^(\d+)[-_](\d+)$/);
      return m ? `${m[1]}_${m[2]}` : tok;
    })
    .join(', ');
}

function csvField(v) {
  v = String(v ?? '');
  return /[,"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

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
    if (data[teacherIdx][dayCols[k]] === 1) before++;
    else break;
  }
  let after = 0;
  for (let k = pos + 1; k < dayCols.length; k++) {
    if (data[teacherIdx][dayCols[k]] === 1) after++;
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

  // 4단계: 업무강도 기반 그리디 배정
  // 현재 누적 업무강도 초기화 (이전누적강도 포함)
  const workload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    workload[i] = teachers[i - 1].prevWorkload ?? 0;
    // 이미 고정된 셀의 강도 반영
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) workload[i] += roles[r - 1]?.workload ?? 0;
    }
  }

  // ponytail: 슬롯별로 모든 보직을 한 번에 처리 — 강도 낮은 교사부터 강도 높은 보직(r=1) 우선 배정
  //   같은 슬롯에서 정감독/부감독 분리 처리 시 한 교사가 부감독 몰아받는 문제 해결
  //   O(슬롯 × 교사²) — 교사/슬롯 수백 이하에서 충분히 빠름
  for (let j = 1; j <= sCount; j++) {
    const { dayIdx, period } = slots[j - 1];

    // 이 슬롯에서 필요한 보직별 잔여 정원 계산 (고정 배정 차감)
    const remain = new Array(roleCount + 1).fill(0);
    for (let r = 1; r <= roleCount; r++) {
      remain[r] = scheduleData[dayIdx]?.[period]?.[r] ?? 0;
    }
    for (let i = 1; i <= tCount; i++) {
      const preRole = extractRole(String(data[i][j]));
      if (preRole > 0 && remain[preRole] > 0) remain[preRole]--;
    }
    const totalRemain = remain.reduce((s, v) => s + v, 0);
    if (totalRemain <= 0) continue;

    // 후보 교사 수집 — 연속 3교시 제한 (2번째 패스에서 완화)
    for (let pass = 0; pass < 2; pass++) {
      const candidates = [];
      for (let i = 1; i <= tCount; i++) {
        if (data[i][j] !== '' && data[i][j] !== 0) continue;
        if (fixedMap[i][j]) continue;
        if (pass === 0 && wouldExceedConsecutive(data, i, j, slots, daySlotMap)) continue;
        candidates.push(i);
      }

      // 강도 낮은 순 정렬, 동점 구간은 셔플로 랜덤성 보장
      candidates.sort((a, b) => workload[a] - workload[b]);
      let ci = 0;
      while (ci < candidates.length) {
        let end = ci + 1;
        while (end < candidates.length && workload[candidates[end]] === workload[candidates[ci]]) end++;
        shuffle(candidates.slice(ci, end)).forEach((v, k) => { candidates[ci + k] = v; });
        ci = end;
      }

      // 강도 높은 보직(r=1 정감독)부터 순서대로 배정
      // ponytail: roles 순서가 정감독→부감독이라 가정. 순서가 다르면 workload 기준 내림차순 정렬 필요.
      for (const i of candidates) {
        let assigned = false;
        for (let r = 1; r <= roleCount; r++) {
          if (remain[r] <= 0) continue;
          data[i][j] = `[${r}]`;
          workload[i] += roles[r - 1]?.workload ?? 0;
          remain[r]--;
          assigned = true;
          break;
        }
        if (!assigned) break; // 모든 정원 소진
        if (remain.reduce((s, v) => s + v, 0) === 0) break;
      }

      if (remain.reduce((s, v) => s + v, 0) === 0) break; // 모두 채웠으면 다음 슬롯
    }
  }

  // 5단계: 보직배정 — 이미 보직이 정해진 셀 제외, 나머지 1인 셀에 보직 부여
  // ponytail: assignRoles는 기존 로직 재사용 (보직 정원 관리 정확)
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

  // 8단계: 제외 고사실 처리
  fixForbiddenRooms(data, fixedMap, slots, teachers, tCount, sCount);

  // 최종 업무강도 재계산 (고사실 배정 후 보직이 바뀐 경우 반영)
  const finalWorkload = new Array(tCount + 1).fill(0);
  for (let i = 1; i <= tCount; i++) {
    let w = teachers[i - 1].prevWorkload ?? 0;
    for (let j = 1; j <= sCount; j++) {
      const r = extractRole(String(data[i][j]));
      if (r > 0) w += roles[r - 1]?.workload ?? 0;
    }
    finalWorkload[i] = w;
  }

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

// ─── 스냅샷 ──────────────────────────────────────────────────────────────────

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
};
