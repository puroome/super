// ui.js — UI 렌더링 및 상태 관리

import {
  assignAll, swapCells, validateAssignment,
  buildSlots, extractRole, extractRoom, calcRoleCounts,
  parseRequirementsCSV, distributeQuota,
  buildSaveSnapshot, applySnapshotToState, emptyState,
  csvField, gridCellDisplay, normalizeSlotStr,
  parseUnavailableSlots, parseRequiredSlots,
  pruneRoomRequirements, aggregateRoomRequirements,
} from './algorithm.js';
import {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
  clearCurrentDocs, saveNamed, listSaves, loadNamed, deleteNamed,
} from './firebase.js';
import {
  printFullTable, printPersonalTable, printAllPersonal,
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
};

// ─── 탭 전환 ─────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-assign') renderAssignGrid();
      if (btn.dataset.tab === 'tab-table') renderSupervisorTable();
    });
  });
}

// ─── 입력 형식 정규화 ─────────────────────────────────────────────────────────
// ponytail: 입력 구분자(쉼표/세미콜론, 하이픈/언더스코어)는 관용적으로 받아주되,
//   저장·표시는 항상 표준형으로 통일한다.
//   - 시간: "일차_교시" (예: 1_3, 2_1) — 하이픈(-)을 쓰면 엑셀이 날짜로 오인하므로 언더스코어 사용
//   - 항목 구분: ", " (쉼표+공백)
//   normalizeSlotStr 자체는 algorithm.js에 있음 (DOM 의존성 없는 순수함수라 테스트 가능)

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
      <td><input type="number" value="${t.quota ?? 0}" onchange="updateTeacher(${i},'quota',+this.value)" style="width:50px"></td>
      <td><input type="number" value="${t.prevWorkload ?? 0}" onchange="updateTeacher(${i},'prevWorkload',+this.value)" style="width:60px"></td>
      <td><input value="${t.forbiddenRooms ?? ''}" title="제외 고사실 (예: 101, 102)" onchange="updateTeacherField(${i},'forbiddenRooms',this)" style="width:90px"></td>
      <td><input value="${t.unavailableSlots ?? ''}" title="제외 시간: 일차_교시 (예: 1_1, 2_3)" onchange="updateTeacherField(${i},'unavailableSlots',this)" style="width:90px"></td>
      <td><input value="${t.requiredSlotStr ?? ''}" title="고정 시간: 일차_교시 (예: 1_2, 2_1)" onchange="updateTeacherField(${i},'requiredSlotStr',this)" style="width:90px"></td>
      <td><input value="${t.requiredRoleStr ?? ''}" title="고정 시간의 감독유형: 1=정감독, 2=부감독 (쉼표 구분, 위 시간과 개수 일치)" onchange="updateTeacherField(${i},'requiredRoleStr',this)" style="width:70px"></td>
      <td><button onclick="removeTeacher(${i})">삭제</button></td>
    </tr>
  `).join('');
}

function autoFillQuota() {
  const slots = buildSlots(state.examDays);
  if (!slots.length || !state.teachers.length) { toast('시험 날짜와 교사를 먼저 입력하세요.'); return 0; }

  const slotNeeds = {};
  state.requirements.forEach(r => {
    const j = slots.findIndex(s => s.dayIdx === r.dayIdx && s.period === r.period) + 1;
    if (j > 0) slotNeeds[j] = (slotNeeds[j] ?? 0) + r.count;
  });
  const totalNeed = Object.values(slotNeeds).reduce((s, v) => s + v, 0);

  if (totalNeed === 0) { toast('배정설정 탭에서 필요인원을 먼저 입력하세요.'); return 0; }

  const n = state.teachers.length;
  const sCount = slots.length;
  const maxPossible = state.teachers.map(t =>
    sCount - parseUnavailableSlots(t.unavailableSlots || '', slots).length
  );

  const { quota, total } = distributeQuota(totalNeed, maxPossible);
  state.teachers.forEach((t, idx) => { t.quota = quota[idx]; });
  renderTeacherList();

  if (total < totalNeed) {
    toast(`⚠️ 최대 가능 시간 초과로 ${totalNeed - total}시간을 배정하지 못했습니다.`, 4000);
  } else {
    toast(`총 ${totalNeed}시간 → 교사 ${n}명에게 자동 배분 완료`);
  }
  return total;
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

// ponytail: 고사실 이름이 바뀌거나 삭제되면, 배정설정(roomRequirements)에 남아있는
//   "더이상 없는 고사실명" 항목은 화면(배정설정 탭)에는 안 보이지만 자동배정 알고리즘은
//   그 항목을 그대로 읽어서 옛 고사실명을 계속 써버린다(고아 데이터). 고사실 목록이 바뀔 때마다
//   이 함수로 정리해야 자동배정 결과에 옛 고사실명이 남는 문제를 막을 수 있다.
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
  // ponytail: 기존 배정설정 완전히 교체 — 덮어쓰기(merge) 아님
  state.roomRequirements = roomRequirements;
  syncRequirements();
  renderRequirementsTab();
  toast('배정감독수 가져오기 완료 (기존 설정 교체)');
}

// ─── 탭3: 자동배정 ───────────────────────────────────────────────────────────

function renderAssignGrid() {
  if (!state.data || !state.slots.length) {
    document.getElementById('assign-grid-wrap').innerHTML =
      '<p>자동배정을 실행하거나 저장된 배정을 불러오세요.</p>';
    return;
  }

  const { data, slots, fixedCells } = state;
  const tCount = state.teachers.length;
  const sCount = slots.length;

  let html = `<div class="grid-scroll"><table class="assign-grid">
  <thead>
    <tr>
      <th>순번</th><th>이름</th><th>배정시간</th><th>제외 고사실</th>
      ${slots.map((s, idx) => {
        const day = state.examDays[s.dayIdx - 1];
        return `<th class="slot-header">${formatDate(day?.date)}<br>${s.period}교시</th>`;
      }).join('')}
      <th>총감독</th><th>업무강도</th>
      ${state.roles.map(r => `<th>${r.name}</th>`).join('')}
    </tr>
  </thead><tbody>`;

  for (let i = 1; i <= tCount; i++) {
    const t = state.teachers[i - 1];
    // ponytail: "고정"은 두 경로로 생긴다 — ①더블클릭 수동잠금(fixedCells) ②교사의 고정시간 설정(requiredSlotStr).
    //   배정 고사실은 바뀌어도 ②는 항상 고정이어야 하므로 매 렌더마다 다시 계산.
    const requiredSlotIdxs = new Set(
      parseRequiredSlots(t.requiredSlotStr || '', t.requiredRoleStr || '', slots).map(r => r.slotIdx)
    );
    html += `<tr>
      <td>${i}</td>
      <td>${t.name}</td>
      <td>${t.quota ?? 0}</td>
      <td>${t.forbiddenRooms || '-'}</td>
      ${slots.map((s, idx) => {
        const j = idx + 1;
        const cell = String(data[i]?.[j] ?? '');
        const isManualFixed = !!fixedCells[i]?.[j];
        const isRequiredFixed = requiredSlotIdxs.has(j);
        const isFixed = isManualFixed || isRequiredFixed;
        const { bg, text } = gridCellDisplay(cell, isFixed);
        const selClass = state.selectedCells.some(c => c.i === i && c.j === j) ? ' selected-cell' : '';
        const title = isRequiredFixed ? '고정시간 설정에 의해 배정됨 (기본정보 탭에서 변경)'
          : isManualFixed ? '고정됨 (더블클릭으로 해제)'
          : '클릭: 선택 / 더블클릭: 고정';
        return `<td class="grid-cell${selClass}" style="background:${bg}"
          onclick="onCellClick(${i},${j})"
          ondblclick="onCellDblClick(${i},${j})"
          title="${title}"
        >${text}</td>`;
      }).join('')}
      <td>${state.roleCounts[i - 1]?.counts.reduce((s, v) => s + v, 0) ?? 0}</td>
      <td>${Math.round(state.workload[i] ?? 0)}</td>
      ${state.roles.map((_, ri) => `<td>${state.roleCounts[i - 1]?.counts[ri + 1] ?? 0}</td>`).join('')}
    </tr>`;
  }

  html += `</tbody></table></div>`;
  document.getElementById('assign-grid-wrap').innerHTML = html;

  document.getElementById('btn-swap').disabled = state.selectedCells.length !== 2;
}

function onCellClick(i, j) {
  const idx = state.selectedCells.findIndex(c => c.i === i && c.j === j);
  if (idx >= 0) state.selectedCells.splice(idx, 1);
  else {
    if (state.selectedCells.length >= 2) state.selectedCells.shift();
    state.selectedCells.push({ i, j });
  }
  renderAssignGrid();
}

function onCellDblClick(i, j) {
  if (!state.fixedCells[i]) state.fixedCells[i] = {};
  if (state.fixedCells[i][j]) {
    delete state.fixedCells[i][j];
    if (!Object.keys(state.fixedCells[i]).length) delete state.fixedCells[i];
  } else {
    state.fixedCells[i][j] = true;
  }
  renderAssignGrid();
}

function doSwap() {
  if (state.selectedCells.length !== 2) return;
  const [c1, c2] = state.selectedCells;
  if (swapCells(state.data, state.fixedCells, c1.i, c1.j, c2.i, c2.j)) {
    const rc = calcRoleCounts(state.data, state.slots, state.teachers, state.roles,
      state.teachers.length, state.slots.length);
    state.roleCounts = rc;
    state.selectedCells = [];
    renderAssignGrid();
    toast('교환 완료');
  }
}

// 표 입력 → 표준형으로 정규화 후 저장 + 화면에 즉시 반영(블러 시 칸이 표준형으로 정리됨)
function updateTeacherField(idx, key, inputEl) {
  let v = inputEl.value;
  if (key === 'unavailableSlots' || key === 'requiredSlotStr') v = normalizeSlotStr(v);
  else if (key === 'requiredRoleStr') v = normalizeRoleStr(v);
  else if (key === 'forbiddenRooms') v = normalizeRoomStr(v);
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

async function runAssign() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = '배정 중...';

  try {
    if (state.teachers.every(t => !t.quota)) autoFillQuota();

    const slots = buildSlots(state.examDays);
    const slotNeeds = {};
    state.requirements.forEach(r => {
      const j = slots.findIndex(s => s.dayIdx === r.dayIdx && s.period === r.period) + 1;
      if (j > 0) slotNeeds[j] = (slotNeeds[j] ?? 0) + r.count;
    });

    const { ok, errors } = validateAssignment(state.teachers, slots, slotNeeds);
    if (!ok) { alert(errors.join('\n')); return; }

    const result = assignAll({
      teachers: state.teachers.map(t => ({
        ...t,
        unavailableSlots: parseUnavailableSlots(t.unavailableSlots || '', slots),
        requiredSlots: parseRequiredSlots(t.requiredSlotStr || '', t.requiredRoleStr || '', slots),
      })),
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

    // ponytail: 옛 데이터(세미콜론·_표기)도 불러올 때 표준형으로 정규화
    state.teachers = (basic.teachers ?? []).map(normalizeTeacherStrings);
    state.rooms = basic.rooms ?? [];
    state.roles = basic.roles ?? [];
    state.examDays = basic.examDays ?? [];
    state.requirements = reqs.requirements ?? [];
    state.roomRequirements = reqs.roomRequirements ?? [];

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
      saveBasic({ teachers: state.teachers, rooms: state.rooms, roles: state.roles, examDays: state.examDays }),
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
    // ponytail: 이름저장 데이터도 불러올 때 표준형으로 정규화
    state.teachers = state.teachers.map(normalizeTeacherStrings);
    state.selectedCells = [];
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

// 배정설정 탭 보직열 축약 표시 (정감독→정, 부감독→부)
function abbreviateRoleForUI(name) {
  if (name === '정감독') return '정';
  if (name === '부감독') return '부';
  return name;
}

// 개별 섹션 초기화
// ponytail: 'requirements'는 roomRequirements와 requirements 둘 다 비워야 배정설정이 완전히 사라짐
function resetSection(section) {
  const labels = {
    examDays: '시험 날짜 및 교시',
    teachers: '감독교사 목록',
    rooms: '고사실 목록',
    roles: '보직 및 업무강도',
    requirements: '배정설정',
  };
  if (!confirm(`"${labels[section] ?? section}" 데이터를 초기화합니다. 계속할까요?`)) return;
  if (section === 'examDays') { state.examDays = []; renderExamDayList(); }
  else if (section === 'teachers') { state.teachers = []; renderTeacherList(); }
  else if (section === 'rooms') { state.rooms = []; pruneStaleRoomRequirements(); renderRoomList(); renderRequirementsTab(); }
  else if (section === 'roles') { state.roles = []; renderRoleList(); }
  else if (section === 'requirements') {
    state.requirements = [];
    state.roomRequirements = [];
    renderRequirementsTab();
  }
  toast(`${labels[section] ?? section} 초기화 완료`);
}

// RFC4180 한 줄 파싱: 큰따옴표로 감싼 필드 안의 쉼표를 보존
// ponytail: 엑셀은 칸에 "1_3, 2_1"처럼 쉼표가 있으면 자동으로 따옴표로 감싸서 저장한다.
//   그래서 칸 안에서도 쉼표(", ")로 통일할 수 있다. 옛 세미콜론 파일도 그대로 읽힌다.
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
  // ponytail: 기존 목록을 완전히 교체 — 덮어쓰기(merge) 아님
  const lines = text.trim().split('\n');
  const dataLines = lines.slice(1).filter(l => l.trim());
  const errors = [];

  const teachers = dataLines.map((line, rowIdx) => {
    const parts = parseCSVLine(line);
    const [name, prevWorkload, forbiddenRooms, unavailableSlots, requiredSlotStr, requiredRoleStr] = parts;

    // 표준형으로 정규화 (시간 일차_교시, 항목 ", ")
    const normRooms = normalizeRoomStr(forbiddenRooms || '');
    const normUnavail = normalizeSlotStr(unavailableSlots || '');
    const normReqSlot = normalizeSlotStr(requiredSlotStr || '');
    const normReqRole = normalizeRoleStr(requiredRoleStr || '');

    if (normReqSlot || normReqRole) {
      const slotsArr = normReqSlot ? normReqSlot.split(',').map(s => s.trim()).filter(Boolean) : [];
      const rolesArr = normReqRole ? normReqRole.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (slotsArr.length !== rolesArr.length) {
        errors.push(
          `${rowIdx + 2}행 (${name || '?'}): ` +
          `고정시간 ${slotsArr.length}개 ≠ 감독유형 ${rolesArr.length}개 — 개수가 일치해야 합니다.`
        );
      }
      slotsArr.forEach(s => {
        if (!/^\d+_\d+$/.test(s)) {
          errors.push(`${rowIdx + 2}행 (${name || '?'}): 고정시간 "${s}"의 형식이 올바르지 않습니다. (올바른 형식: 일차_교시, 예: 1_3)`);
        }
      });
      rolesArr.forEach(r => {
        if (r !== '1' && r !== '2') {
          errors.push(`${rowIdx + 2}행 (${name || '?'}): 감독유형 "${r}"은 1(정감독) 또는 2(부감독)만 입력 가능합니다.`);
        }
      });
    }

    return {
      name: name || '',
      quota: 0,
      prevWorkload: parseFloat(prevWorkload) || 0,
      forbiddenRooms: normRooms,
      unavailableSlots: normUnavail,
      requiredSlotStr: normReqSlot,
      requiredRoleStr: normReqRole,
    };
  });

  if (errors.length > 0) {
    alert(
      '⚠️ CSV 파일에 오류가 있습니다. 수정 후 다시 업로드해주세요.\n\n' +
      errors.join('\n')
    );
    return;
  }

  state.teachers = teachers;
  renderTeacherList();
  toast(`교사 ${state.teachers.length}명 가져오기 완료`);
}

function importRoomCSV(text) {
  // ponytail: 기존 목록을 완전히 교체 — 덮어쓰기(merge) 아님
  const lines = text.trim().split('\n').slice(1);
  state.rooms = lines.map(l => l.trim()).filter(Boolean);
  const removed = pruneStaleRoomRequirements();
  renderRoomList();
  renderRequirementsTab();
  toast(`고사실 ${state.rooms.length}개 가져오기 완료 (기존 목록 교체)`
    + (removed ? ` · 이름이 바뀌어 더이상 없는 고사실의 배정감독수 설정 ${removed}건 삭제됨 — 배정설정 탭에서 다시 입력하세요` : ''), 5000);
}

function downloadTeacherCSVTemplate() {
  const header = '이름,이전누적업무강도,제외고사실,제외시간,고정시간,감독유형';
  const rows = state.teachers.map(t => [
    t.name, t.prevWorkload ?? 0, t.forbiddenRooms ?? '', t.unavailableSlots ?? '', t.requiredSlotStr ?? '', t.requiredRoleStr ?? '',
  ].map(csvField).join(','));
  downloadCSV([header, ...rows].join('\n'), '교사목록_양식.csv');
}

function downloadRoomCSVTemplate() {
  const rows = ['고사실명', ...state.rooms.map(csvField)];
  downloadCSV(rows.join('\n'), '고사실목록_양식.csv');
}

function downloadCSV(content, filename) {
  // ponytail: BOM 추가로 Excel 한글 깨짐 방지
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

window.removeTeacher = (idx) => { state.teachers.splice(idx, 1); renderTeacherList(); };
window.removeRoom = (idx) => {
  state.rooms.splice(idx, 1);
  pruneStaleRoomRequirements();
  renderRoomList();
  renderRequirementsTab();
};
window.removeRole = (idx) => { state.roles.splice(idx, 1); renderRoleList(); };
window.removeExamDay = (idx) => { state.examDays.splice(idx, 1); renderExamDayList(); };

window.addTeacher = () => {
  state.teachers.push({ name: '새교사', quota: 0, prevWorkload: 0, forbiddenRooms: '', unavailableSlots: '', requiredSlotStr: '', requiredRoleStr: '' });
  renderTeacherList();
};
window.addRoom = () => {
  const name = document.getElementById('room-input')?.value.trim();
  if (name) { state.rooms.push(name); renderRoomList(); document.getElementById('room-input').value = ''; }
};
window.addRole = () => {
  state.roles.push({ name: '새보직', workload: 0 });
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
window.autoFillQuota = autoFillQuota;
window.downloadTeacherCSVTemplate = downloadTeacherCSVTemplate;
window.downloadRoomCSVTemplate = downloadRoomCSVTemplate;
window.downloadRequirementsCSVTemplate = downloadRequirementsCSVTemplate;

window.showRequirementsTab = renderRequirementsTab;

window.printFull = () => printFullTable({
  data: state.data, slots: state.slots, teachers: state.teachers,
  rooms: state.rooms, roles: state.roles, examDays: state.examDays,
});
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
