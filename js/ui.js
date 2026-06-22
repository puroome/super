// ui.js — UI 렌더링 및 상태 관리

import {
  assignAll, swapCells, validateAssignment,
  buildSlots, extractRole, extractRoom, calcRoleCounts
} from './algorithm.js';
import {
  loadBasic, saveBasic,
  loadRequirements, saveRequirements,
  loadAssignment, saveAssignment, updateFixedCells, parseAssignment,
} from './firebase.js';
import {
  printFullTable, printDailyTable, printPersonalTable, printAllPersonal,
  formatDate, ROLE_COLORS,
} from './print.js';

// ─── 전역 상태 ────────────────────────────────────────────────────────────────

const state = {
  teachers: [],   // [{name, quota, prevWorkload, forbiddenRooms, unavailableSlots:[]}]
  rooms: [],      // [string]
  roles: [],      // [{name, workload}]
  examDays: [],   // [{date, startPeriod, endPeriod}]
  requirements: [],     // [{dayIdx, period, roleIdx, count}]
  roomRequirements: [], // [{dayIdx, period, roleIdx, roomName, count}]
  data: null,     // 2D 배정 그리드
  fixedCells: {}, // {i: {j: true}}
  workload: [],
  roleCounts: [],
  slots: [],
  selectedCells: [], // 수동 swap용 [{i,j}]
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
      <td><input value="${t.forbiddenRooms ?? ''}" placeholder="1-1,1-2" onchange="updateTeacher(${i},'forbiddenRooms',this.value)" style="width:120px"></td>
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
          <td style="background:${ROLE_COLORS[roleIdx]}">${state.roles[r].name}</td>
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

  // requirements 동기화 (보직별 합계)
  syncRequirements();
}

function syncRequirements() {
  state.requirements = [];
  const map = {};
  state.roomRequirements.forEach(({ dayIdx, period, roleIdx, count }) => {
    const key = `${dayIdx}_${period}_${roleIdx}`;
    map[key] = (map[key] ?? 0) + count;
  });
  for (const [key, count] of Object.entries(map)) {
    const [dayIdx, period, roleIdx] = key.split('_').map(Number);
    state.requirements.push({ dayIdx, period, roleIdx, count });
  }
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

  // 헤더: 날짜/교시
  let html = `<div class="grid-scroll"><table class="assign-grid">
  <thead>
    <tr>
      <th>순번</th><th>이름</th><th>배정시간</th><th>배정불가</th>
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
    const isSelected = state.selectedCells.some(c => c.i === i);
    html += `<tr>
      <td>${i}</td>
      <td>${t.name}</td>
      <td><input type="number" value="${t.quota ?? 0}" onchange="updateTeacherQuota(${i},+this.value)" style="width:45px" min="0"></td>
      <td><input value="${t.forbiddenRooms ?? ''}" onchange="updateTeacher(${i - 1},'forbiddenRooms',this.value)" style="width:80px" placeholder="1-1,1-2"></td>
      ${slots.map((s, idx) => {
        const j = idx + 1;
        const cell = String(data[i]?.[j] ?? '');
        const isFixed = fixedCells[i]?.[j];
        const roleIdx = extractRole(cell);
        const room = extractRoom(cell);
        const bg = isFixed ? '#e7e7e7' : (ROLE_COLORS[roleIdx] ?? '#fff');
        const cellVal = cell === '0' || cell === '' ? '' :
          cell === 'x' ? 'X' :
          roleIdx > 0 ? `${room}[${roleIdx}]` : cell;
        const selClass = state.selectedCells.some(c => c.i === i && c.j === j) ? ' selected-cell' : '';
        return `<td class="grid-cell${selClass}" style="background:${bg}"
          onclick="onCellClick(${i},${j})"
          ondblclick="onCellDblClick(${i},${j})"
          title="${isFixed ? '고정됨 (더블클릭으로 해제)' : '클릭: 선택 / 더블클릭: 고정'}"
        >${cellVal}</td>`;
      }).join('')}
      <td>${state.roleCounts[i - 1]?.counts.reduce((s, v) => s + v, 0) ?? 0}</td>
      <td>${Math.round(state.workload[i] ?? 0)}</td>
      ${state.roles.map((_, ri) => `<td>${state.roleCounts[i - 1]?.counts[ri + 1] ?? 0}</td>`).join('')}
    </tr>`;
  }

  // 하단 통계
  html += `</tbody></table></div>`;
  document.getElementById('assign-grid-wrap').innerHTML = html;

  // swap 버튼 상태
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
    // 업무강도 재계산
    const rc = calcRoleCounts(state.data, state.slots, state.teachers, state.roles,
      state.teachers.length, state.slots.length);
    state.roleCounts = rc;
    state.selectedCells = [];
    renderAssignGrid();
    toast('교환 완료');
  }
}

function updateTeacherQuota(teacherIdx1based, val) {
  state.teachers[teacherIdx1based - 1].quota = val;
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

  // ponytail: buildFullTableHTML을 재사용, 인라인으로도 표시
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
    // 사전 검증
    const slots = buildSlots(state.examDays);
    const slotNeeds = {};
    state.requirements.forEach(r => {
      const j = slots.findIndex(s => s.dayIdx === r.dayIdx && s.period === r.period) + 1;
      if (j > 0) slotNeeds[j] = (slotNeeds[j] ?? 0) + r.count;
    });

    const { ok, errors } = validateAssignment(state.teachers, slots, slotNeeds);
    if (!ok) { alert(errors.join('\n')); return; }

    const result = assignAll({
      teachers: state.teachers,
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

    if (result.forbiddenViolations.length > 0) {
      toast(`⚠️ 배정불가 고사실 ${result.forbiddenViolations.length}건 미해결 — 빨간 셀 확인`, 5000);
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

    state.teachers = basic.teachers ?? [];
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

// ─── CSV 가져오기 ─────────────────────────────────────────────────────────────

function importTeacherCSV(text) {
  const lines = text.trim().split('\n').slice(1); // 헤더 제거
  state.teachers = lines.map(line => {
    const [name, prevWorkload] = line.split(',').map(s => s.trim());
    return { name, quota: 0, prevWorkload: parseFloat(prevWorkload) || 0, forbiddenRooms: '', unavailableSlots: [] };
  });
  renderTeacherList();
  toast(`교사 ${state.teachers.length}명 가져오기 완료`);
}

function importRoomCSV(text) {
  const lines = text.trim().split('\n').slice(1);
  state.rooms = lines.map(l => l.trim()).filter(Boolean);
  renderRoomList();
  toast(`고사실 ${state.rooms.length}개 가져오기 완료`);
}

// ─── 뮤테이션 핸들러 (index.html에서 전역으로 호출) ──────────────────────────

window.updateTeacher = (idx, key, val) => { state.teachers[idx][key] = val; };
window.updateRole = (idx, key, val) => { state.roles[idx][key] = val; };
window.updateExamDay = (idx, key, val) => { state.examDays[idx][key] = val; };
window.updateTeacherQuota = updateTeacherQuota;
window.updateRoomReq = updateRoomReq;
window.onCellClick = onCellClick;
window.onCellDblClick = onCellDblClick;

window.removeTeacher = (idx) => { state.teachers.splice(idx, 1); renderTeacherList(); };
window.removeRoom = (idx) => { state.rooms.splice(idx, 1); renderRoomList(); };
window.removeRole = (idx) => { state.roles.splice(idx, 1); renderRoleList(); };
window.removeExamDay = (idx) => { state.examDays.splice(idx, 1); renderExamDayList(); };

window.addTeacher = () => {
  state.teachers.push({ name: '새교사', quota: 0, prevWorkload: 0, forbiddenRooms: '', unavailableSlots: [] });
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
window.runAssign = runAssign;
window.doSwap = doSwap;

window.showRequirementsTab = renderRequirementsTab;

window.printFull = () => printFullTable({
  data: state.data, slots: state.slots, teachers: state.teachers,
  rooms: state.rooms, roles: state.roles, examDays: state.examDays,
});
window.printDaily = () => printDailyTable({
  data: state.data, slots: state.slots, teachers: state.teachers,
  rooms: state.rooms, roles: state.roles, examDays: state.examDays,
});
window.printPersonal = () => {
  const idx = parseInt(document.getElementById('personal-teacher-select')?.value);
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
