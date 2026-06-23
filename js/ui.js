// ui.js — UI 렌더링 및 상태 관리

import {
  assignAll, swapCells, validateAssignment,
  buildSlots, extractRole, extractRoom, calcRoleCounts, calcWorkload,
  parseRequirementsCSV,
  buildSaveSnapshot, applySnapshotToState, emptyState,
  csvField, gridCellDisplay, normalizeSlotStr,
  parseUnavailableSlots, parseRequiredSlots,
  pruneRoomRequirements, aggregateRoomRequirements,
  removeRoleFromRequirements, removeDayFromRequirements,
} from './algorithm.js';
import {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
  clearCurrentDocs, saveNamed, listSaves, loadNamed, deleteNamed,
} from './firebase.js';
import {
  printFullTable, printPersonalTable, printAllPersonal, downloadFullTableXLSX,
  formatDate, ROLE_COLORS,
} from './print.js';

// ─── 전역 상태 ────────────────────────────────────────────────────────────────

const state = {
  teachers: [],
  rooms: [],
  roles: [],
  examDays: [],
  requirements: [],
  roomRequirements: [],
  data: null,
  fixedCells: {},
  workload: [],
  roleCounts: [],
  slots: [],
  selectedCells: [],
  swapHistory: [],
  // ponytail: 자동배정 탭 그리드에서 직접 지정하는 제외시간/고정(시간) 상태.
  // key: 교사i(1-based) -> { "dayIdx_period": true(제외) | {role:null|1|2}(고정) }
  excludedCells: {},
  preFixed: {},
  gridMode: null,       // 'exclude' | 'fixed' | null
  dragActive: false,
  dragAction: null,      // true=설정, false=해제
};

// 마지막으로 그린 그리드의 슬롯 배열 캐시 (클릭/드래그/우클릭 핸들러에서 공용 사용)
let gridSlots = [];

// ─── 탭 전환 ─────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-assign') { seedGridFromTeacherText(); renderAssignGrid(); }
      if (btn.dataset.tab === 'tab-table') renderSupervisorTable();
    });
  });
}

// ─── 입력 형식 정규화 ─────────────────────────────────────────────────────────

function normalizeRoleStr(str) {
  if (str == null || !String(str).trim()) return '';
  return String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean).join(', ');
}

function normalizeRoomStr(str) {
  if (str == null || !String(str).trim()) return '';
  return String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean).join(', ');
}

function normalizeTeacherStrings(t) {
  return {
    ...t,
    forbiddenRooms: normalizeRoomStr(typeof t.forbiddenRooms === 'string' ? t.forbiddenRooms : ''),
    unavailableSlots: normalizeSlotStr(typeof t.unavailableSlots === 'string' ? t.unavailableSlots : ''),
    requiredSlotStr: normalizeSlotStr(typeof t.requiredSlotStr === 'string' ? t.requiredSlotStr : ''),
    requiredRoleStr: normalizeRoleStr(typeof t.requiredRoleStr === 'string' ? t.requiredRoleStr : ''),
  };
}

// ─── 탭1: 기본정보 ───────────────────────────────────────────────────────────

function renderBasicTab() {
  renderTeacherList();
  renderRoomList();
  renderRoleList();
  renderExamDayList();
}

function renderTeacherList() {
  const el = document.getElementById('teacher-list');
  el.innerHTML = state.teachers.map((t, i) => `
    <tr>
      <td><input value="${t.name}" onchange="updateTeacher(${i},'name',this.value)"></td>
      <td><input type="number" value="${t.prevWorkload ?? 0}" onchange="updateTeacher(${i},'prevWorkload',+this.value)" style="width:60px"></td>
      <td><input value="${t.forbiddenRooms ?? ''}" title="제외 고사실 (예: 101, 102)" onchange="updateTeacherField(${i},'forbiddenRooms',this)" style="width:90px"></td>
      <td><button onclick="removeTeacher(${i})">삭제</button></td>
    </tr>
  `).join('');
}

function renderRoomList() {
  const el = document.getElementById('room-list');
  el.innerHTML = state.rooms.map((r, i) => `
    <span class="tag">${r} <button onclick="removeRoom(${i})">×</button></span>
  `).join('');
}

function renderRoleList() {
  const el = document.getElementById('role-list');
  el.innerHTML = state.roles.map((r, i) => `
    <tr>
      <td><input value="${r.name}" onchange="updateRole(${i},'name',this.value)"></td>
      <td><input type="number" value="${r.workload ?? 0}" onchange="updateRole(${i},'workload',+this.value)" style="width:60px"></td>
      <td><button onclick="removeRole(${i})">삭제</button></td>
    </tr>
  `).join('');
}

function renderExamDayList() {
  const el = document.getElementById('examday-list');
  el.innerHTML = state.examDays.map((d, i) => `
    <tr>
      <td><input type="date" value="${d.date}" onchange="updateExamDay(${i},'date',this.value)"></td>
      <td><input type="number" value="${d.startPeriod}" onchange="updateExamDay(${i},'startPeriod',+this.value)" style="width:50px" min="1" max="9"></td>
      <td><input type="number" value="${d.endPeriod}" onchange="updateExamDay(${i},'endPeriod',+this.value)" style="width:50px" min="1" max="9"></td>
      <td><button onclick="removeExamDay(${i})">삭제</button></td>
    </tr>
  `).join('');
}

// ─── 탭2: 배정설정 ───────────────────────────────────────────────────────────

function renderRequirementsTab() {
  if (!state.examDays.length || !state.roles.length || !state.rooms.length) {
    document.getElementById('req-table-wrap').innerHTML = '<p>기본정보를 먼저 입력해주세요.</p>';
    return;
  }

  const slots = buildSlots(state.examDays);
  const roleCount = state.roles.length;

  let html = `<table class="req-table"><thead><tr>
    <th>날짜</th><th>교시</th><th>보직</th>
    ${state.rooms.map(r => `<th>${r}</th>`).join('')}
  </tr></thead><tbody>`;

  state.examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      for (let r = 0; r < roleCount; r++) {
        const roleIdx = r + 1;
        const dayIdx = di + 1;
        html += `<tr>
          <td>${r === 0 && p === day.startPeriod ? formatDate(day.date) : ''}</td>
          <td>${r === 0 ? p + '교시' : ''}</td>
          <td style="background:${ROLE_COLORS[roleIdx]}">${abbreviateRoleForUI(state.roles[r].name)}</td>
          ${state.rooms.map(room => {
            const existing = state.roomRequirements.find(
              x => x.dayIdx === dayIdx && x.period === p && x.roleIdx === roleIdx && x.roomName === room
            );
            return `<td><input type="number" min="0" value="${existing?.count ?? 0}"
              onchange="updateRoomReq(${dayIdx},${p},${roleIdx},'${room}',+this.value)"
              style="width:40px;text-align:center"></td>`;
          }).join('')}
        </tr>`;
      }
    }
  });

  html += `</tbody></table>`;
  document.getElementById('req-table-wrap').innerHTML = html;
}

function updateRoomReq(dayIdx, period, roleIdx, roomName, count) {
  const idx = state.roomRequirements.findIndex(
    x => x.dayIdx === dayIdx && x.period === period && x.roleIdx === roleIdx && x.roomName === roomName
  );
  if (idx >= 0) {
    if (count === 0) state.roomRequirements.splice(idx, 1);
    else state.roomRequirements[idx].count = count;
  } else if (count > 0) {
    state.roomRequirements.push({ dayIdx, period, roleIdx, roomName, count });
  }
  syncRequirements();
}

function syncRequirements() {
  state.requirements = aggregateRoomRequirements(state.roomRequirements);
}

function pruneStaleRoomRequirements() {
  const before = state.roomRequirements.length;
  state.roomRequirements = pruneRoomRequirements(state.roomRequirements, state.rooms);
  syncRequirements();
  return before - state.roomRequirements.length;
}

function downloadRequirementsCSVTemplate() {
  if (!state.examDays.length || !state.roles.length || !state.rooms.length) {
    toast('기본정보(날짜/보직/고사실)를 먼저 입력하세요.'); return;
  }
  const rows = [['날짜', '교시', '보직', ...state.rooms]];
  state.examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      state.roles.forEach((role, ri) => {
        const roleIdx = ri + 1;
        const counts = state.rooms.map(room => {
          const found = state.roomRequirements.find(x =>
            x.dayIdx === di + 1 && x.period === p && x.roleIdx === roleIdx && x.roomName === room);
          return found?.count ?? 0;
        });
        rows.push([day.date, p, role.name, ...counts]);
      });
    }
  });
  downloadCSV(rows.map(r => r.join(',')).join('\n'), '배정감독수_양식.csv');
}

function importRequirementsCSV(text) {
  const { roomRequirements, errors } = parseRequirementsCSV(text, state.examDays, state.roles);
  if (errors.length > 0) {
    alert('⚠️ CSV 파일에 오류가 있습니다. 수정 후 다시 업로드해주세요.\n\n' + errors.join('\n'));
    return;
  }
  state.roomRequirements = roomRequirements;
  syncRequirements();
  renderRequirementsTab();
  toast('배정감독수 가져오기 완료 (기존 설정 교체)');
}

// ─── 탭3: 자동배정 ───────────────────────────────────────────────────────────

// ─── 탭3: 자동배정 — 제외/고정(시간) 그리드 헬퍼 ────────────────────────────────

function slotKey(dayIdx, period) { return `${dayIdx}_${period}`; }

function ensureCellMap(map, i) {
  if (!map[i]) map[i] = {};
  return map[i];
}

function slotIdxFromKey(key, slots) {
  const [d, p] = key.split('_').map(Number);
  const idx = slots.findIndex(s => s.dayIdx === d && s.period === p);
  return idx >= 0 ? idx + 1 : 0;
}

function keyToToken(key) {
  const [d, p] = key.split('_');
  return `${d}${p}`;
}

// CSV 업로드(또는 예전 방식으로 저장된 데이터)의 제외시간/고정시간/유형 텍스트를
// 그리드 상태(excludedCells/preFixed)로 변환하고, 변환이 끝난 텍스트는 비워서
// 다음에 또 중복 반영되지 않도록 한다. 시험 날짜가 아직 없으면 그대로 둔다(유실 방지).
function seedGridFromTeacherText() {
  const slots = buildSlots(state.examDays);
  if (!slots.length) return;

  state.teachers.forEach((t, idx) => {
    const i = idx + 1;

    if (t.unavailableSlots && t.unavailableSlots.trim()) {
      const slotIdxs = parseUnavailableSlots(t.unavailableSlots, slots);
      if (slotIdxs.length) {
        const m = ensureCellMap(state.excludedCells, i);
        slotIdxs.forEach(j => { m[slotKey(slots[j - 1].dayIdx, slots[j - 1].period)] = true; });
      }
      t.unavailableSlots = '';
    }

    if (t.requiredSlotStr && t.requiredSlotStr.trim()) {
      const roleProvided = !!(t.requiredRoleStr && t.requiredRoleStr.trim());
      const parsedReq = parseRequiredSlots(t.requiredSlotStr, t.requiredRoleStr || '', slots);
      if (parsedReq.length) {
        const m = ensureCellMap(state.preFixed, i);
        parsedReq.forEach(({ slotIdx, roleIdx }) => {
          const key = slotKey(slots[slotIdx - 1].dayIdx, slots[slotIdx - 1].period);
          m[key] = { role: roleProvided ? roleIdx : null };
        });
      }
      t.requiredSlotStr = '';
      t.requiredRoleStr = '';
    }
  });
}

// 한 셀의 표시 상태(배경색/텍스트/툴팁) 계산.
// 배정 결과(state.data)가 아직 없어도(자동배정 실행 전) 제외/고정 표시는 보여야 한다.
function computeCellVisual(i, j, key) {
  const rawCell = state.data ? String(state.data[i]?.[j] ?? '') : '';
  const isExcluded = !!state.excludedCells[i]?.[key];
  const fixedObj = state.preFixed[i]?.[key];
  const isManualFixed = !!state.fixedCells[i]?.[j];

  if (isExcluded) {
    return { bg: '#fbdada', text: 'X', title: '제외 시간 — [제외] 모드로 클릭/드래그하면 해제' };
  }

  if (fixedObj) {
    const { text: roomText } = gridCellDisplay(rawCell, true, false);
    const roleLabel = fixedObj.role === 1 ? '정' : fixedObj.role === 2 ? '부' : '?';
    const text = roomText || roleLabel;
    const title = fixedObj.role
      ? `고정(시간) - ${fixedObj.role === 1 ? '정감독' : '부감독'} ([고정(시간)] 모드에서 더블클릭: 유형 변경 / 클릭: 해제)`
      : '⚠️ 고정(시간) - 유형 미입력! [고정(시간)] 모드에서 이 칸을 더블클릭해 1(정감독) 또는 2(부감독)를 입력하세요';
    return { bg: '#cfe3fa', text, title };
  }

  const { bg, text } = gridCellDisplay(rawCell, isManualFixed, isManualFixed);
  const title = isManualFixed ? '고정됨 (더블클릭으로 해제)' : '클릭: 선택(swap용) / 더블클릭: 고정';
  return { bg, text, title };
}

function setGridMode(mode) {
  state.gridMode = state.gridMode === mode ? null : mode;
  state.dragActive = false;
  state.selectedCells = [];
  renderAssignGrid();
}
window.toggleExcludeMode = () => setGridMode('exclude');
window.toggleFixedMode = () => setGridMode('fixed');

// 드래그 중인 칸 하나에 현재 모드를 적용. 이미 '다른' 모드 상태인 칸은 건너뛴다.
function applyGridModeToCell(i, j, key) {
  if (!state.gridMode) return;
  const isExcludedNow = !!state.excludedCells[i]?.[key];
  const isFixedNow = !!state.preFixed[i]?.[key];

  if (state.gridMode === 'exclude' && isFixedNow) return;   // 고정 칸은 건너뛰기
  if (state.gridMode === 'fixed' && isExcludedNow) return;  // 제외 칸은 건너뛰기
  if (state.fixedCells[i]?.[j]) return; // 배정 후 더블클릭으로 잠긴 칸은 보호

  if (state.gridMode === 'exclude') {
    const m = ensureCellMap(state.excludedCells, i);
    if (state.dragAction) m[key] = true;
    else {
      delete m[key];
      if (!Object.keys(m).length) delete state.excludedCells[i];
    }
  } else {
    const m = ensureCellMap(state.preFixed, i);
    if (state.dragAction) { if (!m[key]) m[key] = { role: null }; }
    else {
      delete m[key];
      if (!Object.keys(m).length) delete state.preFixed[i];
    }
  }
  renderAssignGrid();
}

// 고정(시간) 모드에서 파란 칸을 더블클릭하면 셀 안에 직접 입력창을 띄운다 (네이티브 팝업 없음)
function startFixedRoleEdit(i, j, key) {
  const td = document.querySelector(`#assign-grid-wrap td[data-i="${i}"][data-j="${j}"]`);
  if (!td) return;
  const current = state.preFixed[i]?.[key];

  td.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = 1;
  input.value = current?.role ? String(current.role) : '';
  input.style.width = '26px';
  input.style.textAlign = 'center';
  input.style.fontSize = '11px';
  input.style.padding = '1px';
  input.title = '1=정감독, 2=부감독';
  td.appendChild(input);
  input.focus();
  input.select();

  // 1, 2 외의 문자는 입력 자체를 막아서 잘못된 값 경고가 뜰 일이 없게 한다
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^12]/g, '').slice(0, 1);
  });

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const v = input.value.trim();
    if (v === '1' || v === '2') {
      ensureCellMap(state.preFixed, i)[key] = { role: parseInt(v, 10) };
    }
    renderAssignGrid();
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    renderAssignGrid();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

let gridModeListenersBound = false;
let pendingClick = null; // { i, j, key, timer } — 같은 칸 더블클릭인지 판별 대기 중인 첫 클릭

function cancelPendingClickFor(i, j) {
  if (pendingClick && pendingClick.i === i && pendingClick.j === j) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    return true;
  }
  return false;
}

function flushPendingClick() {
  if (!pendingClick) return;
  const { i, j, key, timer } = pendingClick;
  clearTimeout(timer);
  pendingClick = null;
  applyGridModeToCell(i, j, key);
}

function setupGridModeListeners() {
  if (gridModeListenersBound) return;
  const wrap = document.getElementById('assign-grid-wrap');
  if (!wrap) return;
  gridModeListenersBound = true;

  wrap.addEventListener('mousedown', (e) => {
    if (!state.gridMode) return;
    const td = e.target.closest('.grid-cell');
    if (!td) return;
    e.preventDefault();
    const i = +td.dataset.i, j = +td.dataset.j, key = td.dataset.key;

    // 같은 칸에 짧은 시간 안에 두번째 mousedown = 더블클릭의 일부.
    // 클릭 토글은 절대 적용하지 않고 dblclick 핸들러에게 맡긴다.
    if (cancelPendingClickFor(i, j)) {
      state.dragActive = false;
      return;
    }
    flushPendingClick(); // 다른 칸에 보류 중이던 클릭은 먼저 확정

    state.dragActive = true;
    const currentlyOn = state.gridMode === 'exclude'
      ? !!state.excludedCells[i]?.[key]
      : !!state.preFixed[i]?.[key];
    state.dragAction = !currentlyOn;

    // 곧바로 적용하지 않고 잠깐 대기 — 더블클릭이면 위에서 취소되고,
    // 드래그로 다른 칸에 들어가면 mouseover에서 즉시 확정된다.
    pendingClick = { i, j, key, timer: setTimeout(flushPendingClick, 220) };
  });

  wrap.addEventListener('mouseover', (e) => {
    if (!state.dragActive || !state.gridMode) return;
    const td = e.target.closest('.grid-cell');
    if (!td) return;
    const i = +td.dataset.i, j = +td.dataset.j, key = td.dataset.key;
    if (pendingClick && pendingClick.i === i && pendingClick.j === j) return; // 같은 칸 — 대기 유지
    flushPendingClick(); // 드래그가 확실해졌으니 첫 칸 먼저 확정
    applyGridModeToCell(i, j, key);
  });

  document.addEventListener('mouseup', () => { state.dragActive = false; });
}

function renderAssignGrid() {
  setupGridModeListeners();

  const slots = buildSlots(state.examDays);
  gridSlots = slots;
  const tCount = state.teachers.length;

  if (!tCount || !slots.length) {
    document.getElementById('assign-grid-wrap').innerHTML =
      '<p>기본정보 탭에서 감독교사와 시험 날짜/교시를 먼저 입력하세요.</p>';
    return;
  }

  const excludeBtn = document.getElementById('btn-exclude-mode');
  if (excludeBtn) excludeBtn.classList.toggle('mode-on', state.gridMode === 'exclude');
  const fixedBtn = document.getElementById('btn-fixed-mode');
  if (fixedBtn) fixedBtn.classList.toggle('mode-on', state.gridMode === 'fixed');

  let html = `<div class="grid-scroll"><table class="assign-grid">
  <thead>
    <tr>
      <th>순번</th><th>이름</th><th>제외 고사실</th>
      ${slots.map((s) => {
        const day = state.examDays[s.dayIdx - 1];
        return `<th class="slot-header">${formatDate(day?.date)}<br>${s.period}교시</th>`;
      }).join('')}
      <th>총감독</th><th>누적강도</th>
      ${state.roles.map(r => `<th>${r.name}</th>`).join('')}
    </tr>
  </thead><tbody>`;

  for (let i = 1; i <= tCount; i++) {
    const t = state.teachers[i - 1];
    html += `<tr>
      <td>${i}</td>
      <td>${t.name}</td>
      <td>${t.forbiddenRooms || '-'}</td>
      ${slots.map((s, idx) => {
        const j = idx + 1;
        const key = slotKey(s.dayIdx, s.period);
        const { bg, text, title } = computeCellVisual(i, j, key);
        const selClass = state.selectedCells.some(c => c.i === i && c.j === j) ? ' selected-cell' : '';
        return `<td class="grid-cell${selClass}" data-i="${i}" data-j="${j}" data-key="${key}" style="background:${bg}"
          onclick="onCellClick(${i},${j})"
          ondblclick="onCellDblClick(${i},${j})"
          title="${title}"
        >${text}</td>`;
      }).join('')}
      <td>${state.roleCounts[i - 1]?.counts?.reduce((s, v) => s + v, 0) ?? 0}</td>
      <td>${Math.round(state.workload[i] ?? 0)}</td>
      ${state.roles.map((_, ri) => `<td>${state.roleCounts[i - 1]?.counts?.[ri + 1] ?? 0}</td>`).join('')}
    </tr>`;
  }

  html += `</tbody></table></div>`;
  document.getElementById('assign-grid-wrap').innerHTML = html;
  document.getElementById('btn-swap').disabled = state.selectedCells.length !== 2;

  const histEl = document.getElementById('swap-history');
  if (histEl) histEl.innerHTML = (state.swapHistory ?? [])
    .map((h, i) => `<span class="tag">${h.label} <button onclick="undoSwap(${i})">×</button></span>`)
    .join('');
}

function onCellClick(i, j) {
  if (state.gridMode) return; // 모드 활성 중엔 mousedown 핸들러가 처리

  const key = gridSlots[j - 1] ? slotKey(gridSlots[j - 1].dayIdx, gridSlots[j - 1].period) : null;
  const cell = String(state.data?.[i]?.[j] ?? '');
  const isManualFixed = !!state.fixedCells[i]?.[j];
  const isPreFixed = key ? !!state.preFixed[i]?.[key] : false;
  const isExcludedCell = (key ? !!state.excludedCells[i]?.[key] : false) || cell.toLowerCase() === 'x';
  const isEmpty = cell === '' || cell === '0' || cell === 0;
  if (isManualFixed || isPreFixed || isEmpty || isExcludedCell) return;

  const idx = state.selectedCells.findIndex(c => c.i === i && c.j === j);
  if (idx >= 0) state.selectedCells.splice(idx, 1);
  else {
    if (state.selectedCells.length >= 2) state.selectedCells.shift();
    state.selectedCells.push({ i, j });
  }
  renderAssignGrid();
}

function onCellDblClick(i, j) {
  const key = gridSlots[j - 1] ? slotKey(gridSlots[j - 1].dayIdx, gridSlots[j - 1].period) : null;
  cancelPendingClickFor(i, j); // 더블클릭이므로 보류 중이던 단일클릭 토글은 적용하지 않음

  if (state.gridMode === 'fixed') {
    // 고정(시간) 모드: 파란 칸(고정 지정된 칸)만 더블클릭으로 유형 입력, 다른 칸은 무시
    if (key && state.preFixed[i]?.[key]) startFixedRoleEdit(i, j, key);
    return;
  }
  if (state.gridMode === 'exclude') return; // 제외 모드에서는 더블클릭 동작 없음

  // 평상시(모드 비활성) — 기존 수동 고정 토글
  if (!state.fixedCells[i]) state.fixedCells[i] = {};
  if (state.fixedCells[i][j]) {
    delete state.fixedCells[i][j];
    if (!Object.keys(state.fixedCells[i]).length) delete state.fixedCells[i];
  } else {
    // ponytail: 배정값(고사실 포함) 저장으로 재실행 시 시간+고사실 모두 고정
    state.fixedCells[i][j] = state.data[i]?.[j] ?? 1;
  }
  renderAssignGrid();
}

function refreshAssignmentStats() {
  state.roleCounts = calcRoleCounts(state.data, state.slots, state.teachers, state.roles,
    state.teachers.length, state.slots.length);
  state.workload = calcWorkload(state.data, state.teachers, state.roles,
    state.teachers.length, state.slots.length);
}

function doSwap() {
  if (state.selectedCells.length !== 2) return;
  const [c1, c2] = state.selectedCells;
  if (swapCells(state.data, state.fixedCells, c1.i, c1.j, c2.i, c2.j)) {
    refreshAssignmentStats();
    if (!state.swapHistory) state.swapHistory = [];
    const getName = (c) => state.teachers[c.i - 1]?.name ?? c.i;
    const getSlot = (c) => state.slots[c.j - 1] ? `${state.slots[c.j - 1].dayIdx}일${state.slots[c.j - 1].period}교시` : c.j;
    state.swapHistory.push({ c1, c2, label: `${getName(c1)} ${getSlot(c1)} ↔ ${getName(c2)} ${getSlot(c2)}` });
    state.selectedCells = [];
    renderAssignGrid();
    toast('교환 완료');
  } else {
    toast('고정된 셀은 교환할 수 없습니다');
  }
}

window.undoSwap = (idx) => {
  const h = state.swapHistory?.[idx];
  if (!h) return;
  swapCells(state.data, state.fixedCells, h.c1.i, h.c1.j, h.c2.i, h.c2.j);
  refreshAssignmentStats();
  state.swapHistory.splice(idx, 1);
  renderAssignGrid();
};

function updateTeacherField(idx, key, inputEl) {
  let v = inputEl.value;
  if (key === 'forbiddenRooms') v = normalizeRoomStr(v);
  state.teachers[idx][key] = v;
  inputEl.value = v;
}

// ─── 탭4: 감독표 ─────────────────────────────────────────────────────────────

function renderSupervisorTable() {
  if (!state.data || !state.slots.length) {
    document.getElementById('table-wrap').innerHTML = '<p>배정 결과가 없습니다.</p>';
    return;
  }

  const params = {
    data: state.data, slots: state.slots, teachers: state.teachers,
    rooms: state.rooms, roles: state.roles, examDays: state.examDays,
  };

  import('./print.js').then(({ buildFullTableHTML }) => {
    document.getElementById('table-wrap').innerHTML = buildFullTableHTML(params);
  });
}

function renderPersonalSelect() {
  const sel = document.getElementById('personal-teacher-select');
  sel.innerHTML = state.teachers.map((t, i) =>
    `<option value="${i + 1}">${t.name}</option>`
  ).join('');
}

// ─── 자동배정 실행 ────────────────────────────────────────────────────────────

function findPendingFixedCells() {
  const pending = [];
  Object.keys(state.preFixed).forEach(iStr => {
    const i = +iStr;
    Object.entries(state.preFixed[i] || {}).forEach(([key, v]) => {
      if (!v || (v.role !== 1 && v.role !== 2)) pending.push(i);
    });
  });
  return [...new Set(pending)];
}

function buildTeacherSlotData(slots) {
  return state.teachers.map((t, idx) => {
    const i = idx + 1;
    const unavailableSlots = Object.keys(state.excludedCells[i] || {})
      .map(key => slotIdxFromKey(key, slots))
      .filter(j => j > 0);
    const requiredSlots = Object.entries(state.preFixed[i] || {})
      .filter(([, v]) => v && (v.role === 1 || v.role === 2))
      .map(([key, v]) => ({ slotIdx: slotIdxFromKey(key, slots), roleIdx: v.role }))
      .filter(r => r.slotIdx > 0);
    return { ...t, unavailableSlots, requiredSlots };
  });
}

async function runAssign() {
  const pendingTeacherIdxs = findPendingFixedCells();
  if (pendingTeacherIdxs.length) {
    const names = pendingTeacherIdxs.map(i => state.teachers[i - 1]?.name || `#${i}`).join(', ');
    alert(
      `⚠️ 고정(시간)으로 지정했지만 정/부 유형(1 또는 2)을 입력하지 않은 칸이 있습니다.\n` +
      `[고정(시간)] 모드를 켜고 해당 칸(파란색, "?" 표시)을 더블클릭해서 유형을 입력한 후 다시 시도하세요.\n\n` +
      `대상 교사: ${names}`
    );
    return;
  }

  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = '배정 중...';

  try {
    const { ok, errors } = validateAssignment(state.slots, state.requirements);
    if (!ok) { alert(errors.join('\n')); return; }

    const slots = buildSlots(state.examDays);

    const result = assignAll({
      teachers: buildTeacherSlotData(slots),
      examDays: state.examDays,
      roles: state.roles,
      requirements: state.requirements,
      roomRequirements: state.roomRequirements,
      fixedCells: state.fixedCells,
    });

    state.data = result.data;
    state.slots = result.slots;
    state.workload = result.workload;
    state.roleCounts = result.roleCounts;
    state.swapHistory = [];

    if (result.roomShortages.length > 0) {
      toast(`⚠️ 고사실 칸보다 배정인원이 많아 ${result.roomShortages.length}자리 미배정 — 배정설정의 보직별 합계를 확인하세요`, 6000);
    } else if (result.forbiddenViolations.length > 0) {
      toast(`⚠️ 제외 고사실 ${result.forbiddenViolations.length}건 미해결 — 빨간 셀 확인`, 5000);
    } else {
      toast('✅ 배정 완료');
    }

    renderAssignGrid();

    await saveAssignment({
      data: state.data,
      fixedCells: state.fixedCells,
      workload: state.workload,
      roleCounts: state.roleCounts,
      slots: state.slots,
    });
  } catch (e) {
    alert('배정 중 오류: ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 자동배정 실행';
  }
}

// ─── 초기 데이터 로드 ─────────────────────────────────────────────────────────

async function loadAll() {
  showLoading(true);
  try {
    const [basic, reqs, assign] = await Promise.all([
      loadBasic(), loadRequirements(), loadAssignment(),
    ]);

    state.teachers = (basic.teachers ?? []).map(normalizeTeacherStrings);
    state.rooms = basic.rooms ?? [];
    state.roles = basic.roles ?? [];
    state.examDays = basic.examDays ?? [];
    state.requirements = reqs.requirements ?? [];
    state.roomRequirements = reqs.roomRequirements ?? [];
    state.excludedCells = basic.excludedCells ?? {};
    state.preFixed = basic.preFixed ?? {};
    // ponytail: 예전 방식(텍스트 입력)으로 저장된 데이터가 남아있으면 그리드 상태로 변환
    seedGridFromTeacherText();

    if (assign) {
      const parsed = parseAssignment(assign);
      state.data = parsed.data;
      state.fixedCells = parsed.fixedCells;
      state.workload = parsed.workload;
      state.roleCounts = parsed.roleCounts;
      state.slots = parsed.slots;
    }

    renderBasicTab();
    renderPersonalSelect();
  } catch (e) {
    toast('데이터 로드 실패: ' + e.message, 4000);
    console.error(e);
  } finally {
    showLoading(false);
  }
}

// ─── 저장 ────────────────────────────────────────────────────────────────────

async function saveAll() {
  try {
    await Promise.all([
      saveBasic({
        teachers: state.teachers, rooms: state.rooms, roles: state.roles, examDays: state.examDays,
        excludedCells: state.excludedCells, preFixed: state.preFixed,
      }),
      saveRequirements({ requirements: state.requirements, roomRequirements: state.roomRequirements }),
    ]);
    if (state.data) {
      await saveAssignment({ data: state.data, fixedCells: state.fixedCells, workload: state.workload, roleCounts: state.roleCounts, slots: state.slots });
    }
    toast('✅ 저장 완료');
  } catch (e) {
    toast('저장 실패: ' + e.message, 4000);
    console.error(e);
  }
}

// ─── 초기화 / 이름 지정 저장 / 불러오기 ──────────────────────────────────────

function rerenderAll() {
  renderBasicTab();
  renderRequirementsTab();
  renderAssignGrid();
  renderSupervisorTable();
  renderPersonalSelect();
}

async function resetAll() {
  if (!confirm('입력된 모든 데이터를 지웁니다. 저장하지 않은 내용은 사라집니다. 계속할까요?')) return;
  Object.assign(state, emptyState());
  state.selectedCells = [];
  state.swapHistory = [];
  rerenderAll();
  try {
    await clearCurrentDocs();
  } catch (e) {
    console.error(e);
  }
  toast('초기화 완료 — 새로 입력해주세요');
}

async function saveAsNamed() {
  const name = window.prompt('저장할 이름을 입력하세요 (예: 2026 1학기 중간고사)', '');
  if (!name || !name.trim()) return;
  try {
    await saveNamed(name.trim(), buildSaveSnapshot(state));
    toast(`✅ "${name.trim()}" 이름으로 저장 완료`);
  } catch (e) {
    toast('저장 실패: ' + e.message, 4000);
    console.error(e);
  }
}

let saveListCache = [];

function formatSaveDate(ts) {
  try {
    if (ts?.toDate) {
      return ts.toDate().toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    }
  } catch (e) { /* 무시 */ }
  return '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function openLoadModal() {
  const modal = document.getElementById('load-modal');
  const listEl = document.getElementById('load-list');
  modal.style.display = 'flex';
  listEl.innerHTML = '<p style="color:#7a8599">불러오는 중...</p>';
  try {
    saveListCache = await listSaves();
    if (!saveListCache.length) {
      listEl.innerHTML = '<p style="color:#7a8599">저장된 데이터가 없습니다.</p>';
      return;
    }
    listEl.innerHTML = saveListCache.map(s => `
      <div class="save-item">
        <div>
          <span class="save-name">${escapeHtml(s.name)}</span>
          <span class="save-date">${formatSaveDate(s.savedAt)}</span>
        </div>
        <div class="save-actions">
          <button class="btn-primary" onclick="loadNamedAndApply('${s.id}')">불러오기</button>
          <button class="btn-danger" onclick="deleteNamedConfirm('${s.id}')">삭제</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<p style="color:#e53935">목록을 불러오지 못했습니다.</p>';
    console.error(e);
  }
}

function closeLoadModal() {
  document.getElementById('load-modal').style.display = 'none';
}

async function loadNamedAndApply(id) {
  try {
    const snapshot = await loadNamed(id);
    if (!snapshot) { toast('데이터를 찾을 수 없습니다.'); return; }
    Object.assign(state, applySnapshotToState(snapshot));
    state.teachers = state.teachers.map(normalizeTeacherStrings);
    state.selectedCells = [];
    state.swapHistory = [];
    rerenderAll();
    closeLoadModal();
    toast('✅ 불러오기 완료');
  } catch (e) {
    toast('불러오기 실패: ' + e.message, 4000);
    console.error(e);
  }
}

async function deleteNamedConfirm(id) {
  const item = saveListCache.find(s => s.id === id);
  if (!confirm(`"${item?.name ?? ''}" 저장을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    await deleteNamed(id);
    toast('삭제 완료');
    openLoadModal();
  } catch (e) {
    toast('삭제 실패: ' + e.message, 4000);
    console.error(e);
  }
}

// ─── CSV 가져오기 ─────────────────────────────────────────────────────────────

function abbreviateRoleForUI(name) {
  if (name === '정감독') return '정';
  if (name === '부감독') return '부';
  return name;
}

function resetSection(section) {
  const labels = {
    examDays: '시험 날짜 및 교시',
    teachers: '감독교사 목록',
    rooms: '고사실 목록',
    roles: '보직 및 업무강도',
    requirements: '배정설정',
    assign: '자동배정 결과 · 제외시간 · 고정(시간) 표시',
  };
  const impactedCount = (section === 'examDays' || section === 'roles') ? state.roomRequirements.length : 0;
  const warn = impactedCount ? `\n⚠️ 배정설정 데이터 ${impactedCount}건도 함께 삭제됩니다.` : '';
  if (!confirm(`"${labels[section] ?? section}" 데이터를 초기화합니다.${warn}\n계속할까요?`)) return;
  if (section === 'examDays') { state.examDays = []; state.roomRequirements = []; syncRequirements(); renderExamDayList(); renderRequirementsTab(); }
  else if (section === 'teachers') { state.teachers = []; state.excludedCells = {}; state.preFixed = {}; renderTeacherList(); }
  else if (section === 'rooms') { state.rooms = []; pruneStaleRoomRequirements(); renderRoomList(); renderRequirementsTab(); }
  else if (section === 'roles') { state.roles = []; state.roomRequirements = []; syncRequirements(); renderRoleList(); renderRequirementsTab(); }
  else if (section === 'requirements') { state.requirements = []; state.roomRequirements = []; renderRequirementsTab(); }
  else if (section === 'assign') {
    state.data = null;
    state.fixedCells = {};
    state.workload = [];
    state.roleCounts = [];
    state.slots = [];
    state.selectedCells = [];
    state.swapHistory = [];
    state.excludedCells = {};
    state.preFixed = {};
    state.gridMode = null;
    state.dragActive = false;
    renderAssignGrid();
  }
  toast(`${labels[section] ?? section} 초기화 완료`);
}

function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function importTeacherCSV(text) {
  const lines = text.trim().split('\n');
  const dataLines = lines.slice(1).filter(l => l.trim());
  const errors = [];

  const teachers = dataLines.map((line, rowIdx) => {
    const parts = parseCSVLine(line);
    const [name, prevWorkload, forbiddenRooms, unavailableSlots, requiredSlotStr, requiredRoleStr] = parts;

    const normRooms = normalizeRoomStr(forbiddenRooms || '');
    const normUnavail = normalizeSlotStr(unavailableSlots || '');
    const normReqSlot = normalizeSlotStr(requiredSlotStr || '');
    const normReqRole = normalizeRoleStr(requiredRoleStr || '');

    const slotsArr = normReqSlot ? normReqSlot.split(',').map(s => s.trim()).filter(Boolean) : [];
    const rolesArr = normReqRole ? normReqRole.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (normReqSlot) {
      slotsArr.forEach(s => {
        if (!/^\d{2,}$/.test(s)) errors.push(`${rowIdx + 2}행 (${name || '?'}): 고정시간 "${s}"의 형식이 올바르지 않습니다. 예: 12 = 1일차 2교시`);
      });
      if (state.examDays.length) {
        const parsedSlots = parseRequiredSlots(normReqSlot, '', buildSlots(state.examDays));
        if (parsedSlots.length !== slotsArr.length) {
          errors.push(`${rowIdx + 2}행 (${name || '?'}): 고정시간 중 시험 날짜/교시에 없는 값이 있습니다.`);
        }
      }
    }

    // 고정감독 유형은 CSV 업로드 시 비워둘 수 있음.
    // 비워둔 경우에는 나중에 '유형' 헤더 클릭 팝업으로 일괄 입력한다.
    if (normReqRole) {
      if (!normReqSlot) {
        errors.push(`${rowIdx + 2}행 (${name || '?'}): 감독유형은 고정시간이 있을 때만 입력할 수 있습니다.`);
      } else if (slotsArr.length !== rolesArr.length) {
        errors.push(`${rowIdx + 2}행 (${name || '?'}): 고정시간 ${slotsArr.length}개 ≠ 감독유형 ${rolesArr.length}개 — 개수가 일치해야 합니다.`);
      }
      rolesArr.forEach(r => {
        if (r !== '1' && r !== '2') errors.push(`${rowIdx + 2}행 (${name || '?'}): 감독유형 "${r}"은 1(정감독) 또는 2(부감독)만 입력 가능합니다.`);
      });
    }

    return {
      name: name || '',
      prevWorkload: parseFloat(prevWorkload) || 0,
      forbiddenRooms: normRooms,
      unavailableSlots: normUnavail,
      requiredSlotStr: normReqSlot,
      requiredRoleStr: normReqRole,
    };
  });

  if (errors.length > 0) {
    alert('⚠️ CSV 파일에 오류가 있습니다. 수정 후 다시 업로드해주세요.\n\n' + errors.join('\n'));
    return;
  }

  state.teachers = teachers;
  state.excludedCells = {};
  state.preFixed = {};
  seedGridFromTeacherText();
  renderTeacherList();
  toast(`교사 ${state.teachers.length}명 가져오기 완료`);
}

function importRoomCSV(text) {
  const lines = text.trim().split('\n').slice(1);
  const newRooms = lines.map(l => l.trim()).filter(Boolean);
  const kept = pruneRoomRequirements(state.roomRequirements, newRooms);
  const affected = state.roomRequirements.length - kept.length;
  if (!confirmStaleImpact(affected, '고사실 목록 전체')) return;
  state.rooms = newRooms;
  state.roomRequirements = kept;
  syncRequirements();
  renderRoomList();
  renderRequirementsTab();
  toast(`고사실 ${state.rooms.length}개 가져오기 완료 (기존 목록 교체)`
    + (affected ? ` · 이름이 바뀌어 더이상 없는 고사실의 배정감독수 설정 ${affected}건 삭제됨 — 배정설정 탭에서 다시 입력하세요` : ''), 5000);
}

function downloadTeacherCSVTemplate() {
  const header = '이름,이전누적업무강도,제외고사실,제외시간,고정시간,감독유형';
  const rows = state.teachers.map((t, idx) => {
    const i = idx + 1;
    const unavailToken = Object.keys(state.excludedCells[i] || {}).map(keyToToken).join(', ');
    const fixedEntries = Object.entries(state.preFixed[i] || {});
    const fixedTimeToken = fixedEntries.map(([key]) => keyToToken(key)).join(', ');
    const fixedRoleToken = fixedEntries.map(([, v]) => v?.role ?? '').join(', ');
    return [t.name, t.prevWorkload ?? 0, t.forbiddenRooms ?? '', unavailToken, fixedTimeToken, fixedRoleToken]
      .map(csvField).join(',');
  });
  downloadCSV([header, ...rows].join('\n'), '교사목록_양식.csv');
}

function downloadRoomCSVTemplate() {
  const rows = ['고사실명', ...state.rooms.map(csvField)];
  downloadCSV(rows.join('\n'), '고사실목록_양식.csv');
}

function downloadCSV(content, filename) {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── 뮤테이션 핸들러 ─────────────────────────────────────────────────────────

window.updateTeacher = (idx, key, val) => { state.teachers[idx][key] = val; };
window.updateTeacherField = updateTeacherField;
window.updateRole = (idx, key, val) => { state.roles[idx][key] = val; };
window.updateExamDay = (idx, key, val) => { state.examDays[idx][key] = val; };
window.updateRoomReq = updateRoomReq;
window.onCellClick = onCellClick;
window.onCellDblClick = onCellDblClick;

function confirmStaleImpact(affectedCount, what) {
  if (!affectedCount) return true;
  return confirm(
    `"${what}"과 관련된 배정설정(배정감독수) 데이터 ${affectedCount}건이 있습니다.\n` +
    `삭제하면 이 데이터도 같이 정리됩니다. 삭제 후 배정설정 탭에서 꼭 다시 확인해주세요.\n계속하시겠습니까?`
  );
}

function reindexTeacherMapsAfterRemoval(removedI) {
  [state.excludedCells, state.preFixed, state.fixedCells].forEach(map => {
    delete map[removedI];
    Object.keys(map).map(Number).filter(k => k > removedI).sort((a, b) => a - b).forEach(k => {
      map[k - 1] = map[k];
      delete map[k];
    });
  });
}

window.removeTeacher = (idx) => {
  const removedI = idx + 1;
  state.teachers.splice(idx, 1);
  reindexTeacherMapsAfterRemoval(removedI);
  renderTeacherList();
};
window.removeRoom = (idx) => {
  const room = state.rooms[idx];
  const affected = state.roomRequirements.filter(r => r.roomName === room).length;
  if (!confirmStaleImpact(affected, `고사실 "${room}"`)) return;
  state.rooms.splice(idx, 1);
  pruneStaleRoomRequirements();
  renderRoomList();
  renderRequirementsTab();
};
window.removeRole = (idx) => {
  const removedRoleIdx = idx + 1;
  const role = state.roles[idx];
  const affected = state.roomRequirements.filter(r => r.roleIdx === removedRoleIdx).length;
  if (!confirmStaleImpact(affected, `보직 "${role?.name}"`)) return;
  state.roles.splice(idx, 1);
  state.roomRequirements = removeRoleFromRequirements(state.roomRequirements, removedRoleIdx);
  syncRequirements();
  renderRoleList();
  renderRequirementsTab();
};
window.removeExamDay = (idx) => {
  const removedDayIdx = idx + 1;
  const day = state.examDays[idx];
  const affected = state.roomRequirements.filter(r => r.dayIdx === removedDayIdx).length;
  if (!confirmStaleImpact(affected, `날짜 "${formatDate(day?.date)}"`)) return;
  state.examDays.splice(idx, 1);
  state.roomRequirements = removeDayFromRequirements(state.roomRequirements, removedDayIdx);
  syncRequirements();
  renderExamDayList();
  renderRequirementsTab();
};

window.addTeacher = () => {
  state.teachers.push({ name: '', prevWorkload: 0, forbiddenRooms: '', unavailableSlots: '', requiredSlotStr: '', requiredRoleStr: '' });
  renderTeacherList();
};
window.addRoom = () => {
  const name = prompt('고사실명을 입력하세요 (예: 101)')?.trim();
  if (name) { state.rooms.push(name); renderRoomList(); }
};
window.addRole = () => {
  state.roles.push({ name: '', workload: 0 });
  renderRoleList();
};
window.addExamDay = () => {
  state.examDays.push({ date: '', startPeriod: 1, endPeriod: 4 });
  renderExamDayList();
};

window.saveAll = saveAll;
window.resetAll = resetAll;
window.resetSection = resetSection;
window.saveAsNamed = saveAsNamed;
window.openLoadModal = openLoadModal;
window.closeLoadModal = closeLoadModal;
window.loadNamedAndApply = loadNamedAndApply;
window.deleteNamedConfirm = deleteNamedConfirm;
window.runAssign = runAssign;
window.doSwap = doSwap;
window.downloadTeacherCSVTemplate = downloadTeacherCSVTemplate;
window.downloadRoomCSVTemplate = downloadRoomCSVTemplate;
window.downloadRequirementsCSVTemplate = downloadRequirementsCSVTemplate;

window.showRequirementsTab = renderRequirementsTab;


function fullTableParams() {
  return {
    data: state.data, slots: state.slots, teachers: state.teachers,
    rooms: state.rooms, roles: state.roles, examDays: state.examDays,
  };
}

function hasAssignmentForOutput() {
  if (!state.data || !state.slots.length) {
    toast('배정 결과가 없습니다. 자동배정 탭에서 배정을 실행하세요.');
    return false;
  }
  return true;
}

window.openFullTableOutputMenu = (btnEl) => {
  document.getElementById('full-table-output-menu')?.remove();
  if (!hasAssignmentForOutput()) return;

  const menu = document.createElement('div');
  menu.id = 'full-table-output-menu';
  menu.className = 'output-menu';

  const addItem = (label, onClick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.onclick = () => {
      menu.remove();
      onClick();
    };
    menu.appendChild(item);
  };

  addItem('파일저장', () => downloadFullTableXLSX(fullTableParams()));
  addItem('인쇄', () => printFullTable(fullTableParams()));

  document.body.appendChild(menu);
  const rect = btnEl?.getBoundingClientRect?.();
  if (rect) {
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
  } else {
    menu.style.top = '80px';
    menu.style.left = '20px';
  }
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
};

// 기존 onclick 이름 호환용
window.printFull = () => window.openFullTableOutputMenu();
window.printPersonalByValue = (val) => {
  const idx = parseInt(val);
  if (!idx) return;
  printPersonalTable({
    data: state.data, slots: state.slots,
    teacher: state.teachers[idx - 1], teacherIdx: idx,
    roles: state.roles, examDays: state.examDays,
  });
};
window.printAllPersonal = () => printAllPersonal({
  data: state.data, slots: state.slots, teachers: state.teachers,
  roles: state.roles, examDays: state.examDays,
});

window.handleTeacherCSV = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(importTeacherCSV);
};
window.handleRoomCSV = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(importRoomCSV);
};
window.handleRequirementsCSV = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then(importRequirementsCSV);
};

window.openPrevWorkloadPicker = async (thEl) => {
  document.getElementById('prev-workload-picker')?.remove();
  const saves = await listSaves();
  if (!saves.length) { toast('저장된 자료가 없습니다'); return; }

  const picker = document.createElement('div');
  picker.id = 'prev-workload-picker';
  picker.style.cssText = 'position:absolute;background:#fff;border:1px solid #d0d7e3;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.12);z-index:999;min-width:180px;padding:4px 0';
  saves.forEach(s => {
    const item = document.createElement('div');
    item.textContent = s.name;
    item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px';
    item.onmouseenter = () => item.style.background = '#f0f4fa';
    item.onmouseleave = () => item.style.background = '';
    item.onclick = async () => {
      picker.remove();
      const snapshot = await loadNamed(s.id);
      if (!snapshot) { toast('불러오기 실패'); return; }
      const prevTeachers = snapshot.teachers ?? [];
      const workload = snapshot.assignment?.workload;
      state.teachers.forEach(t => {
        const prevIdx = prevTeachers.findIndex(p => p.name === t.name);
        // ponytail: workload는 1-based 배열, prevIdx는 0-based라 +1
        t.prevWorkload = (workload && prevIdx >= 0) ? (workload[prevIdx + 1] ?? 0) : 0;
      });
      renderTeacherList();
      toast('이전누적강도 적용 완료');
    };
    picker.appendChild(item);
  });

  const rect = thEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + window.scrollY) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0);
};

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function showLoading(on) {
  const el = document.getElementById('loading');
  if (el) el.style.display = on ? 'flex' : 'none';
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────

export function init() {
  initTabs();
  loadAll();
}
