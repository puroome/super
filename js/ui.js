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
  rooms: [],       // 고사실명 문자열 배열 (기존 유지)
  roomMeta: [],    // [{ name, grade, isAssistant }] — CSV 3열 구조
  roles: [],
  examDays: [],
  // examDayRooms 제거됨 — 배정설정 탭에서 직접 관리
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
      if (btn.dataset.tab === 'tab-req') renderRequirementsTab();
      if (btn.dataset.tab === 'tab-assign') { seedGridFromTeacherText(); renderAssignGrid(); }
      if (btn.dataset.tab === 'tab-table') renderSupervisorTable();
      // (배정설정 탭 복원됨 — roomRequirements는 CSV 업로드 또는 화면 편집으로 설정)
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
  const el = document.getElementById('teacher-list-grid');
  if (!el) return;
  if (!state.teachers.length) {
    el.innerHTML = '<p style="color:#999;font-size:12px;padding:4px">교사를 추가하거나 CSV로 업로드하세요.</p>';
    return;
  }
  el.innerHTML = state.teachers.map((t, i) => `
    <div class="teacher-card">
      <input name="name" value="${t.name}" placeholder="이름" style="${t.name.length > 3 ? 'font-size:' + Math.max(9.6, 14.4 * 3 / t.name.length) + 'px' : ''}" onchange="updateTeacher(${i},'name',this.value);this.style.fontSize=this.value.length>3?Math.max(9.6,14.4*3/this.value.length)+'px':''">
      <input name="workload" type="number" value="${t.prevWorkload > 0 ? t.prevWorkload : ''}" placeholder="" title="이전누적강도" min="0" step="1" pattern="[0-9]*" inputmode="numeric" onchange="updateTeacher(${i},'prevWorkload',+this.value)" onkeypress="return event.charCode>=48&&event.charCode<=57">
      <input name="forbidden" value="${t.forbiddenRooms ?? ''}" placeholder="" title="제외 고사실 (예: 101)" onchange="updateTeacherField(${i},'forbiddenRooms',this)">
      <button class="teacher-card-del" onclick="removeTeacher(${i})" title="삭제">×</button>
    </div>
  `).join('');
}

function renderRoomList() {
  const el = document.getElementById('room-list');
  if (!el) return;
  if (!state.roomMeta.length) {
    el.innerHTML = '<span style="font-size:12px;color:#e53935;font-weight:600">고사실 미등록</span>';
  } else {
    el.innerHTML = '<span style="font-size:12px;color:#388e3c;font-weight:600">✓ 고사실 등록</span>'
      + `<span style="font-size:11px;color:#888;margin-left:6px">(${state.roomMeta.length}개)</span>`;
  }
}

function renderRoleList() {
  const el = document.getElementById('role-list');
  const chief  = state.roles[0]; // 정감독 (고정)
  const assist = state.roles[1]; // 부감독 (옵션)

  const assistActive = assist && assist.active !== false;
  const assistWorkload = assist?.workload ?? '';

  el.innerHTML = `
    <tr>
      <td><span style="font-weight:600;color:var(--text)">정감독</span></td>
      <td><span style="font-weight:600;color:var(--text)">100</span></td>
      <td style="color:#aaa;font-size:11px">고정</td>
    </tr>
    <tr style="${assistActive ? '' : 'opacity:0.45'}">
      <td><span style="font-weight:600;color:${assistActive ? 'var(--text)' : '#aaa'}">부감독</span></td>
      <td>
        <input type="number" value="${assistWorkload}"
          placeholder=""
          title="부감독 업무강도 (정감독=100 기준)"
          style="width:60px;-moz-appearance:textfield;text-align:center"
          ${assistActive ? '' : 'disabled'}
          onchange="updateAssistWorkload(+this.value)"
          onkeypress="return event.charCode>=48&&event.charCode<=57">
      </td>
      <td>
        <button class="${assistActive ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}"
          onclick="toggleAssistRole()"
          style="white-space:nowrap">
          ${assistActive ? '부감독 비활성화' : '부감독 활성화'}
        </button>
      </td>
    </tr>
  `;

  // 숫자 input 상하버튼 제거 (CSS 방어)
  el.querySelectorAll('input[type="number"]').forEach(inp => {
    inp.style.setProperty('-webkit-appearance', 'none');
  });
}

function renderExamDayList() {
  const el = document.getElementById('examday-list');
  el.innerHTML = state.examDays.map((d, i) => {
    return `
      <tr>
        <td><input type="date" value="${d.date}" onchange="updateExamDay(${i},'date',this.value)"></td>
        <td><input type="number" value="${d.startPeriod}" onchange="updateExamDay(${i},'startPeriod',+this.value)" style="width:44px;text-align:center;-webkit-appearance:none;-moz-appearance:textfield" min="1" max="9"></td>
        <td><input type="number" value="${d.endPeriod}" onchange="updateExamDay(${i},'endPeriod',+this.value)" style="width:44px;text-align:center;-webkit-appearance:none;-moz-appearance:textfield" min="1" max="9"></td>
        <td><button onclick="removeExamDay(${i})">삭제</button></td>
      </tr>`;
  }).join('');
}

// ─── 탭2: 배정설정 ───────────────────────────────────────────────────────────

function renderRequirementsTab() {
  const wrap = document.getElementById('req-table-wrap');
  if (!wrap) return;

  if (!state.examDays.length || !state.rooms.length) {
    wrap.innerHTML = '<p style="color:#7a8599">기본정보(날짜/고사실)를 먼저 입력해주세요.</p>';
    return;
  }

  const slots = buildSlots(state.examDays);
  if (!slots.length) {
    wrap.innerHTML = '<p style="color:#7a8599">시험 날짜/교시를 먼저 입력해주세요.</p>';
    return;
  }

  // 고사실별 감독유형 맵 (isAssistant: true → 부감독, false → 정감독)
  const metaMap = {};
  state.roomMeta.forEach(m => { metaMap[m.name] = m; });

  // 모든 고사실 목록 (state.rooms 기준)
  const allRooms = state.rooms;

  // 정감독=옅은녹색, 부감독=옅은노랑
  const COLOR_CHIEF   = '#eaf6ec'; // 옅은 녹색
  const COLOR_ASSIST  = '#fff3cd'; // 옅은 노랑

  function getRoleIdx(roomName) {
    const meta = metaMap[roomName];
    if (meta?.isAssistant) {
      // 부감독 역할이 활성화된 경우
      const assistRole = state.roles.find(r => r.name === '부감독');
      if (assistRole && assistRole.active !== false) {
        return state.roles.findIndex(r => r.name === '부감독') + 1;
      }
    }
    return state.roles.findIndex(r => r.name === '정감독') + 1;
  }

  function getCellColor(roomName) {
    const meta = metaMap[roomName];
    if (meta?.isAssistant) {
      const assistRole = state.roles.find(r => r.name === '부감독');
      if (assistRole && assistRole.active !== false) return COLOR_ASSIST;
    }
    return COLOR_CHIEF;
  }

  function getCellValue(dayIdx, period, roomName) {
    // roomName 기준으로 검색 (더블클릭 편집으로 roleIdx가 바뀐 경우도 정상 표시)
    const found = state.roomRequirements.find(
      x => x.dayIdx === dayIdx && x.period === period && x.roomName === roomName
    );
    return found ? found.count : 0;
  }

  // 날짜 그룹화 (같은 날짜의 교시들을 rowspan으로 묶기)
  // 슬롯 구조: { dayIdx, period }
  let html = `<div class="req-grid-scroll" id="req-grid-scroll">
  <table class="req-grid">
  <thead>
    <tr>
      <th class="req-sticky-date" data-col="0">날짜</th>
      <th class="req-sticky-period" data-col="1">교시</th>
      ${allRooms.map((r, ci) => {
        const color = getCellColor(r);
        return `<th data-col="${ci + 2}" style="background:${color === COLOR_ASSIST ? '#c8a600' : '#4a7c59'};color:white">${r}</th>`;
      }).join('')}
    </tr>
  </thead>
  <tbody>`;

  // 날짜+교시 → 슬롯 순서대로 행 생성
  state.examDays.forEach((day, di) => {
    const dayIdx = di + 1;
    const periodCount = day.endPeriod - day.startPeriod + 1;

    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      const isFirstPeriod = (p === day.startPeriod);
      const isLastPeriod  = (p === day.endPeriod);
      html += `<tr${isLastPeriod ? ' class="req-date-sep"' : ''}>`;

      if (isFirstPeriod) {
        html += `<td class="req-sticky-date" data-col="0" rowspan="${periodCount}" style="border-bottom:2px solid #6070a0">${formatDate(day.date)}</td>`;
      }

      html += `<td class="req-sticky-period" data-col="1">${p}</td>`;

      allRooms.forEach((roomName, ci) => {
        const cellColor = getCellColor(roomName);
        const val = getCellValue(dayIdx, p, roomName);
        html += `<td class="req-cell"
          style="background:${val > 0 ? cellColor : '#fff'};cursor:pointer"
          data-day="${dayIdx}" data-period="${p}" data-room="${encodeURIComponent(roomName)}"
          data-assigned="${val > 0 ? 1 : 0}"
          data-color="${cellColor}"
          data-col="${ci + 2}"
          ondblclick="reqCellDblClick(this)"
          title="더블클릭: 배치/미배치 전환"
        ></td>`;
      });

      html += `</tr>`;
    }
  });

  html += `</tbody></table></div>`;
  wrap.innerHTML = html;

  // 내부 스크롤 + 키보드 스크롤
  const scrollEl = document.getElementById('req-grid-scroll');
  if (scrollEl) {
    scrollEl.setAttribute('tabindex', '0');
    scrollEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      scrollEl.scrollTop  += e.deltaY;
      scrollEl.scrollLeft += e.deltaX;
    }, { passive: false });
    scrollEl.addEventListener('keydown', (e) => {
      const step = 40;
      if (e.key === 'ArrowDown')  { e.preventDefault(); scrollEl.scrollTop  += step; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); scrollEl.scrollTop  -= step; }
      if (e.key === 'ArrowRight') { e.preventDefault(); scrollEl.scrollLeft += step; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollEl.scrollLeft -= step; }
    });
    scrollEl.addEventListener('mouseenter', () => scrollEl.focus({ preventScroll: true }));
  }

  // 셀 포커스 (행·열 강조)
  const table = wrap.querySelector('.req-grid');
  if (!table) return;
  const headerRow = table.querySelector('thead tr');
  const allColHeaders = headerRow ? Array.from(headerRow.querySelectorAll('th')) : [];
  let lastFR = -1, lastFC = -1;

  table.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || cell.closest('thead')) {
      if (lastFR !== -1 || lastFC !== -1) reqClearFocus(table);
      lastFR = -1; lastFC = -1; return;
    }
    const tr = cell.closest('tr');
    if (!tr) return;
    // data-col 속성으로 논리적 열 번호 읽기 (rowspan 어긋남 방지)
    const col = parseInt(cell.dataset.col ?? '-1', 10);
    const rowIdx = Array.from(table.querySelectorAll('tbody tr')).indexOf(tr);
    // col < 2: 날짜(0)·교시(1) 열은 포커스 행 테두리 미적용 (교시는 헤더 강조만)
    if (rowIdx < 0 || col < 1) { reqClearFocus(table); lastFR = -1; lastFC = -1; return; }
    if (rowIdx === lastFR && col === lastFC) return;
    lastFR = rowIdx; lastFC = col;
    reqApplyFocus(table, allColHeaders, rowIdx, col);
  });
  table.addEventListener('mouseleave', () => { reqClearFocus(table); lastFR = -1; lastFC = -1; });
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

// ── 배정설정 탭 셀 포커스 헬퍼 ──────────────────────────────────────────────
function reqApplyFocus(table, allColHeaders, focusRow, focusCol) {
  reqClearFocus(table);

  // 열 헤더 강조 (data-col 기준)
  const colTh = allColHeaders.find(th => parseInt(th.dataset.col ?? '-1', 10) === focusCol);
  if (colTh) colTh.classList.add('req-focus-col-header');

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const targetRow = rows[focusRow];

  // 행 강조: 해당 행의 td 중 날짜열(col=0) 제외하고 테두리 적용
  if (targetRow) {
    Array.from(targetRow.cells).forEach(td => {
      const c = parseInt(td.dataset.col ?? '-1', 10);
      if (c >= 1) td.classList.add('req-focus-row');  // 교시(1)부터만 행 테두리
    });
    // 교시 td를 행 헤더 강조
    const periodTd = Array.from(targetRow.cells).find(td => parseInt(td.dataset.col ?? '-1', 10) === 1);
    if (periodTd) periodTd.classList.add('req-focus-row-header');
  }

  // 열 강조: 모든 행에서 같은 data-col을 가진 td에 테두리
  rows.forEach(tr => {
    const td = Array.from(tr.cells).find(c => parseInt(c.dataset.col ?? '-1', 10) === focusCol);
    if (td) td.classList.add('req-focus-col');
  });
}

function reqClearFocus(table) {
  table.querySelectorAll('.req-focus-col-header, .req-focus-row-header, .req-focus-row, .req-focus-col')
    .forEach(el => el.classList.remove('req-focus-col-header', 'req-focus-row-header', 'req-focus-row', 'req-focus-col'));
}

// ── 배정설정 탭 더블클릭 — 배치/미배치 토글 ──────────────────────────────────
window.reqCellDblClick = function(td) {
  const dayIdx   = +td.dataset.day;
  const period   = +td.dataset.period;
  const roomName = decodeURIComponent(td.dataset.room);

  const COLOR_CHIEF  = '#eaf6ec';
  const COLOR_ASSIST = '#fff3cd';

  // 현재 배정 여부 확인
  const existIdx = state.roomRequirements.findIndex(
    x => x.dayIdx === dayIdx && x.period === period && x.roomName === roomName
  );

  if (existIdx >= 0) {
    // ── 배치 → 미배치 토글 ──
    state.roomRequirements.splice(existIdx, 1);
    td.style.background = '#fff';
    td.dataset.assigned = '0';
  } else {
    // ── 미배치 → 배치 토글 ──
    // 감독유형은 고사실 메타(isAssistant)에서 자동 결정
    const meta = state.roomMeta.find(m => m.name === roomName);
    const isAssist = meta?.isAssistant ?? false;
    const assistRole = state.roles.find(r => r.name === '부감독');
    const assistActive = assistRole && assistRole.active !== false;

    const roleIdx = (isAssist && assistActive)
      ? state.roles.findIndex(r => r.name === '부감독') + 1
      : state.roles.findIndex(r => r.name === '정감독') + 1;
    const cellColor = (isAssist && assistActive) ? COLOR_ASSIST : COLOR_CHIEF;

    state.roomRequirements.push({ dayIdx, period, roleIdx, roomName, count: 1 });
    td.style.background = cellColor;
    td.dataset.color    = cellColor;
    td.dataset.assigned = '1';
  }

  syncRequirements();
};

function syncRequirements() {
  state.requirements = aggregateRoomRequirements(state.roomRequirements);
}

// ─── 날짜별 고사실 선택 드롭다운 ─────────────────────────────────────────────


function pruneStaleRoomRequirements() {
  const before = state.roomRequirements.length;
  state.roomRequirements = pruneRoomRequirements(state.roomRequirements, state.rooms);
  syncRequirements();
  return before - state.roomRequirements.length;
}

function downloadRequirementsCSVTemplate() {
  if (!state.examDays.length || !state.rooms.length) {
    toast('기본정보(날짜/고사실)를 먼저 입력하세요.'); return;
  }
  const metaMap = {};
  state.roomMeta.forEach(m => { metaMap[m.name] = m; });

  // 헤더: 날짜, 교시, 고사실명들
  const rows = [['날짜', '교시', ...state.rooms]];

  state.examDays.forEach((day, di) => {
    const dayIdx = di + 1;

    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      const cells = state.rooms.map(roomName => {
        const found = state.roomRequirements.find(x =>
          x.dayIdx === dayIdx && x.period === p && x.roomName === roomName
        );
        // 기존 배정 있으면 '1', 없으면 빈칸
        return found ? '1' : '';
      });
      rows.push([day.date, p, ...cells]);
    }
  });

  downloadCSV(rows.map(r => r.join(',')).join('\n'), '배정감독수_양식.csv');
}

function importRequirementsCSV(text) {
  // 새 CSV 포맷: 날짜, 교시, [고사실명...]
  // 각 고사실 셀이 비어있지 않으면 → 배정 1명
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) { toast('CSV 파일이 비어있거나 형식이 잘못되었습니다.'); return; }

  const headers = parseCSVLine(lines[0]);
  // headers[0]=날짜, headers[1]=교시, headers[2..]= 고사실명들
  const roomHeaders = headers.slice(2).map(h => h.trim());

  const metaMap = {};
  state.roomMeta.forEach(m => { metaMap[m.name] = m; });

  const assistRole = state.roles.find(r => r.name === '부감독');
  const assistActive = assistRole && assistRole.active !== false;
  const chiefRoleIdx = state.roles.findIndex(r => r.name === '정감독') + 1;
  const assistRoleIdx = assistActive ? state.roles.findIndex(r => r.name === '부감독') + 1 : 0;

  const newReqs = [];
  const errors = [];

  lines.slice(1).forEach((line, li) => {
    const parts = parseCSVLine(line);
    const dateStr  = (parts[0] ?? '').trim();
    const periodStr = (parts[1] ?? '').trim();
    if (!dateStr || !periodStr) return;

    const period = parseInt(periodStr, 10);
    if (isNaN(period)) { errors.push(`${li + 2}행: 교시 "${periodStr}"이 숫자가 아닙니다.`); return; }

    // 날짜 → dayIdx 매핑
    const dayIdx = state.examDays.findIndex(d => d.date === dateStr) + 1;
    if (!dayIdx) { errors.push(`${li + 2}행: 날짜 "${dateStr}"이 기본정보에 없습니다.`); return; }

    roomHeaders.forEach((roomName, ri) => {
      const val = (parts[ri + 2] ?? '').trim();
      if (!val) return; // 빈칸 → 배정 없음

      // 해당 고사실 감독유형 결정
      const meta = metaMap[roomName];
      const isAssist = meta?.isAssistant;
      const roleIdx = (isAssist && assistRoleIdx) ? assistRoleIdx : chiefRoleIdx;

      if (!roleIdx) return;
      newReqs.push({ dayIdx, period, roleIdx, roomName, count: 1 });
    });
  });

  if (errors.length > 0) {
    showErrorModal({
      title: '배정감독수 CSV 오류',
      desc: 'CSV 파일을 읽는 중 오류가 발생했습니다. 파일을 수정 후 다시 업로드해 주세요.',
      errors,
      fix: '● 날짜는 기본정보에 등록된 날짜와 정확히 일치해야 합니다 (예: 2026-07-15).\n● 교시는 숫자만 입력하세요.\n● CSV양식 받기 버튼으로 올바른 양식을 먼저 받아 사용하면 편리합니다.',
    });
    return;
  }

  state.roomRequirements = newReqs;
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

  let html = `<div class="grid-scroll" id="assign-grid-scroll"><table class="assign-grid">
  <thead>
    <tr>
      <th>순<br>번</th><th>이름</th><th>제외<br>고사실</th>
      ${slots.map((s, idx) => {
        const day = state.examDays[s.dayIdx - 1];
        return `<th class="slot-header" data-col="${idx + 3}">${formatDate(day?.date)}<br>${s.period}교시</th>`;
      }).join('')}
      <th class="sticky-right sticky-total-sep">총<br>감독</th>
      ${state.roles.map(r => { const parts = r.name === '정감독' ? ['정','감독'] : r.name === '부감독' ? ['부','감독'] : [r.name]; return `<th class="sticky-right">${parts.join('<br>')}</th>`; }).join('')}
      <th class="sticky-right sticky-right-sep">누적<br>강도</th>
    </tr>
  </thead><tbody>`;

  // 오른쪽 고정 열 수: 총감독 + 감독유형 수 + 누적강도
  const rightFixedCount = 2 + state.roles.length;

  for (let i = 1; i <= tCount; i++) {
    const t = state.teachers[i - 1];
    const roleCells = state.roles.map((_, ri) =>
      `<td class="sticky-right" style="user-select:none;pointer-events:none">${state.roleCounts[i - 1]?.counts?.[ri + 1] ?? 0}</td>`
    ).join('');
    html += `<tr data-row="${i}">
      <td>${i}</td>
      <td class="row-header-cell" style="${t.name.length > 3 ? 'font-size:' + Math.max(7.15, 12.35 * 3 / t.name.length) + 'px' : ''}">${t.name}</td>
      <td>${t.forbiddenRooms || '-'}</td>
      ${slots.map((s, idx) => {
        const j = idx + 1;
        const key = slotKey(s.dayIdx, s.period);
        const { bg, text, title } = computeCellVisual(i, j, key);
        const selClass = state.selectedCells.some(c => c.i === i && c.j === j) ? ' selected-cell' : '';
        return `<td class="grid-cell${selClass}" data-i="${i}" data-j="${j}" data-col="${idx + 3}" data-key="${key}" style="background:${bg}"
          onclick="onCellClick(${i},${j})"
          ondblclick="onCellDblClick(${i},${j})"
          title="${title}"
        >${text}</td>`;
      }).join('')}
      <td class="sticky-right sticky-total sticky-total-sep" style="user-select:none;pointer-events:none;cursor:default">${state.roleCounts[i - 1]?.counts?.reduce((s, v) => s + v, 0) ?? 0}</td>
      ${roleCells}
      <td class="sticky-right sticky-right-sep" style="user-select:none;pointer-events:none">${Math.round(state.workload[i] ?? 0)}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  document.getElementById('assign-grid-wrap').innerHTML = html;
  document.getElementById('btn-swap').disabled = state.selectedCells.length !== 2;

  const histEl = document.getElementById('swap-history');
  if (histEl) histEl.innerHTML = (state.swapHistory ?? [])
    .map((h, i) => `<span class="tag">${h.label} <button onclick="undoSwap(${i})">×</button></span>`)
    .join('');

  // ── sticky-right 열 right 값 동적 계산 ──────────────────────────────
  // 렌더 직후 각 열 너비를 읽어서 right 값을 역순으로 누적 적용
  requestAnimationFrame(() => {
    const gridEl = document.querySelector('#assign-grid-scroll .assign-grid');
    if (!gridEl) return;
    const headerCells = Array.from(gridEl.querySelectorAll('thead tr th'));
    const stickyRightThs = [];
    for (let k = headerCells.length - 1; k >= 0; k--) {
      if (headerCells[k].classList.contains('sticky-right')) stickyRightThs.unshift(headerCells[k]);
      else break;
    }
    let accumulated = 0;
    for (let k = stickyRightThs.length - 1; k >= 0; k--) {
      const th = stickyRightThs[k];
      const w = th.offsetWidth;
      th.style.right = accumulated + 'px';
      // 같은 열 인덱스의 모든 td에도 적용
      const colIdx = Array.from(headerCells).indexOf(th);
      gridEl.querySelectorAll(`tbody tr`).forEach(tr => {
        const td = tr.cells[colIdx];
        if (td) { td.style.right = accumulated + 'px'; }
      });
      accumulated += w;
    }
  });

  // ── 마우스휠 내부 스크롤 ──────────────────────────────────────────────
  const scrollEl = document.getElementById('assign-grid-scroll');
  if (scrollEl) {
    scrollEl.setAttribute('tabindex', '0'); // 키보드 포커스 받을 수 있게
    scrollEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      scrollEl.scrollTop += e.deltaY;
      scrollEl.scrollLeft += e.deltaX;
    }, { passive: false });

    // 키보드 상하좌우 스크롤
    scrollEl.addEventListener('keydown', (e) => {
      const step = 40;
      if (e.key === 'ArrowDown')  { e.preventDefault(); scrollEl.scrollTop  += step; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); scrollEl.scrollTop  -= step; }
      if (e.key === 'ArrowRight') { e.preventDefault(); scrollEl.scrollLeft += step; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollEl.scrollLeft -= step; }
    });

    // 그리드 위에 마우스 들어오면 키보드 포커스 자동 이동
    scrollEl.addEventListener('mouseenter', () => scrollEl.focus({ preventScroll: true }));
  }

  // ── 포커스셀: 마우스 호버 시 행·열 헤더 강조 + 바깥 테두리 ──────────
  const table = scrollEl?.querySelector('.assign-grid');
  if (!table) return;

  const headerRow = table.querySelector('thead tr');
  const allColHeaders = headerRow ? Array.from(headerRow.querySelectorAll('th')) : [];

  let lastFocusRow = -1;
  let lastFocusCol = -1;

  table.addEventListener('mousemove', (e) => {
    // th 또는 td 모두 대응
    const cell = e.target.closest('td, th');
    if (!cell || cell.tagName === 'TH' && cell.closest('thead')) {
      // 헤더 행 위 → 초기화
      if (lastFocusRow !== -1 || lastFocusCol !== -1) clearFocus(table);
      lastFocusRow = -1; lastFocusCol = -1;
      return;
    }

    // 현재 행 인덱스(1-based) 구하기
    const tr = cell.closest('tr');
    const row = tr ? parseInt(tr.dataset.row ?? -1) : -1;
    if (row < 1) { clearFocus(table); lastFocusRow = -1; lastFocusCol = -1; return; }

    // 현재 열 인덱스(cellIndex) 구하기 — 모든 td 기준
    const col = cell.cellIndex;

    // 순번(0)·이름(1) 열은 포커스 비활성
    if (col <= 1) { clearFocus(table); lastFocusRow = -1; lastFocusCol = -1; return; }

    if (row === lastFocusRow && col === lastFocusCol) return;
    lastFocusRow = row;
    lastFocusCol = col;
    applyFocus(table, allColHeaders, row, col, tCount, slots.length);
  });

  table.addEventListener('mouseleave', () => {
    clearFocus(table);
    lastFocusRow = -1; lastFocusCol = -1;
  });
}

function applyFocus(table, allColHeaders, focusRow, focusCol, tCount, sCount) {
  clearFocus(table);

  // ── 열 헤더(1행) 강조 ──
  const colTh = allColHeaders[focusCol];
  if (colTh) colTh.classList.add('focus-col-header');

  // ── 해당 행의 이름 td(2번째 열, cellIndex=1) 강조 ──
  const targetRow = table.querySelector(`tr[data-row="${focusRow}"]`);
  if (targetRow) {
    const nameTd = targetRow.cells[1];
    if (nameTd) nameTd.classList.add('focus-row-header');
  }

  // ── 행 강조: 해당 행의 모든 td에 top/bottom 테두리 클래스 ──
  if (targetRow) {
    Array.from(targetRow.cells).forEach((td, ci) => {
      td.classList.add('focus-row');
    });
  }

  // ── 열 강조: 모든 행의 focusCol번째 td에 left/right 테두리 클래스 ──
  table.querySelectorAll(`tbody tr[data-row]`).forEach(tr => {
    const td = tr.cells[focusCol];
    if (td) td.classList.add('focus-col');
  });
}

function clearFocus(table) {
  table.querySelectorAll('.focus-col-header, .focus-row-header, .focus-row, .focus-col')
    .forEach(el => el.classList.remove('focus-col-header', 'focus-row-header', 'focus-row', 'focus-col'));
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
    showErrorModal({
      title: '고정(시간) 감독유형 미입력',
      desc: '고정(시간)으로 지정했지만 정감독/부감독 유형을 입력하지 않은 칸이 있습니다.\n자동배정을 실행하려면 모든 고정(시간) 칸에 감독유형이 지정되어 있어야 합니다.',
      errors: [`감독유형 미입력 대상 교사: ${names}`],
      fix: '① 자동배정 탭에서 [고정(시간)] 버튼을 클릭하여 모드를 켭니다.\n② 파란색으로 표시되고 "?" 가 있는 칸을 더블클릭합니다.\n③ 입력창에 1(정감독) 또는 2(부감독)를 입력하고 Enter를 누릅니다.\n④ 모든 칸에 유형을 지정한 후 다시 자동배정을 실행하세요.',
    });
    return;
  }

  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = '배정 중...';

  try {
    const { ok, errors } = validateAssignment(state.slots, state.requirements);
    if (!ok) {
      showErrorModal({
        title: '자동배정 실행 불가',
        desc: '배정을 실행하기 위한 필수 조건이 충족되지 않았습니다.',
        errors,
        fix: '배정설정 탭으로 이동하여 고사실별 감독인원을 설정한 후 다시 시도하세요.\n● CSV를 업로드하거나 셀을 더블클릭하여 직접 입력할 수 있습니다.',
      });
      return;
    }

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
      const shortageDetails = result.roomShortages.map(s => {
        const slot = result.slots[s.j - 1];
        const day = slot ? state.examDays[slot.dayIdx - 1] : null;
        const dateStr = day ? formatDate(day.date) : `${s.j}번 슬롯`;
        const period = slot ? `${slot.period}교시` : '';
        const roleName = state.roles[s.roleIdx - 1]?.name ?? `감독유형${s.roleIdx}`;
        return `${dateStr} ${period} — ${roleName} 미배정`;
      });
      showErrorModal({
        title: '배정 미완료: 고사실 부족',
        desc: `배정설정에 설정된 고사실 수보다 배정되어야 할 교사 수가 많아 ${result.roomShortages.length}자리가 미배정 처리되었습니다.\n\n자동배정 테이블에서 "미배정"으로 표시된 셀을 확인하세요.`,
        errors: shortageDetails,
        fix: '다음 중 하나를 수정하세요:\n① 배정설정 탭에서 해당 날짜/교시의 미배정 고사실을 추가로 배정하세요.\n② 교사 목록에서 해당 교사의 제외 고사실이 너무 많지 않은지 확인하세요.\n③ 배정할 교사 수와 고사실 수가 일치하는지 확인하세요.',
      });
    } else if (result.forbiddenViolations.length > 0) {
      const violationDetails = result.forbiddenViolations.map(v => {
        const teacher = state.teachers[v.i - 1]?.name ?? `#${v.i}`;
        const slot = result.slots[v.j - 1];
        const day = slot ? state.examDays[slot.dayIdx - 1] : null;
        const dateStr = day ? formatDate(day.date) : `슬롯${v.j}`;
        const period = slot ? `${slot.period}교시` : '';
        return `${teacher} — ${dateStr} ${period}에 제외 고사실 배정됨`;
      });
      showErrorModal({
        title: '배정 경고: 제외 고사실 위반',
        desc: `교사의 "제외 고사실" 설정이 있지만 해당 고사실에 배정되지 못한 경우가 ${result.forbiddenViolations.length}건 발생했습니다.\n\n자동배정 테이블에서 빨간색 셀을 확인하세요.`,
        errors: violationDetails,
        fix: '다음을 확인하세요:\n① 교사 목록에서 제외 고사실 설정이 올바른지 확인하세요.\n② 제외 고사실이 너무 많아 배정 가능한 고사실이 없는 경우일 수 있습니다.\n③ 배정 후 해당 셀을 수동으로 교환(⇄ 선택 셀 교환)하여 조정하세요.',
      });
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
    showErrorModal({
      title: '배정 실행 중 오류 발생',
      desc: '자동배정 처리 중 예상치 못한 오류가 발생했습니다.',
      errors: [e.message],
      fix: '입력 데이터(교사 목록, 고사실, 배정설정)를 확인하고 다시 시도하세요.\n문제가 지속되면 전체 초기화 후 데이터를 다시 입력해 주세요.',
    });
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
    state.roomMeta = basic.roomMeta ?? state.rooms.map(name => ({ name, grade: null, isAssistant: false }));
    state.roles = basic.roles?.length
      ? basic.roles
      : [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50, active: true }];
    state.examDays = basic.examDays ?? [];
    // examDayRooms 제거됨
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
        teachers: state.teachers, rooms: state.rooms, roomMeta: state.roomMeta,
        roles: state.roles, examDays: state.examDays,
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
    examAndRooms: '시험일 및 고사실',
    examDays: '시험 날짜 및 교시',
    teachers: '감독교사 목록',
    rooms: '고사실 목록',
    roles: '감독유형 및 업무강도',
    requirements: '배정감독수 설정',
    assign: '자동배정 결과 · 제외시간 · 고정(시간) 표시',
  };
  if (!confirm(`"${labels[section] ?? section}" 데이터를 초기화합니다. 계속할까요?`)) return;

  if (section === 'examAndRooms') {
    state.examDays = [];
    state.rooms = []; state.roomMeta = [];
    state.roomRequirements = []; syncRequirements();
    renderRoomList(); renderExamDayList();
  } else if (section === 'examDays') {
    state.examDays = [];
    state.roomRequirements = []; syncRequirements(); renderExamDayList();
  } else if (section === 'teachers') {
    state.teachers = []; state.excludedCells = {}; state.preFixed = {}; renderTeacherList();
  } else if (section === 'rooms') {
    state.rooms = []; state.roomMeta = [];
    pruneStaleRoomRequirements(); renderRoomList(); renderExamDayList();
  } else if (section === 'roles') {
    state.roles = [{ name: '정감독', workload: 100 }, { name: '부감독', workload: 50, active: true }];
    state.roomRequirements = []; syncRequirements(); renderRoleList();
  } else if (section === 'requirements') {
    // CSV로 올린 배정 데이터만 초기화 (기본정보 날짜/고사실은 유지)
    state.roomRequirements = []; syncRequirements(); renderRequirementsTab();
  } else if (section === 'assign') {
    state.data = null; state.fixedCells = {}; state.workload = []; state.roleCounts = [];
    state.slots = []; state.selectedCells = []; state.swapHistory = [];
    state.excludedCells = {}; state.preFixed = {};
    state.gridMode = null; state.dragActive = false;
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
    showErrorModal({
      title: '교사 CSV 오류',
      desc: 'CSV 파일을 읽는 중 오류가 발생했습니다. 파일을 수정 후 다시 업로드해 주세요.',
      errors,
      fix: '● CSV양식 받기 버튼으로 올바른 양식을 먼저 받아 사용하면 편리합니다.\n● 감독유형 열은 고정시간이 있을 때만 1(정감독) 또는 2(부감독)를 입력하세요.\n● 고정시간과 감독유형의 개수가 일치해야 합니다 (쉼표로 구분).',
    });
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
  const lines = text.trim().split('\n');
  const dataLines = lines.slice(1).filter(l => l.trim());

  const newMeta = dataLines.map(line => {
    const parts = parseCSVLine(line);
    const name = (parts[0] ?? '').trim();
    const assistantVal = (parts[1] ?? '').trim(); // 빈칸이 아니면 부감독
    return {
      name,
      grade: null,
      isAssistant: assistantVal !== '',
    };
  }).filter(m => m.name);

  const newRooms = newMeta.map(m => m.name);
  const kept = pruneRoomRequirements(state.roomRequirements, newRooms);
  const affected = state.roomRequirements.length - kept.length;
  if (affected > 0 && !confirm(`고사실 목록이 바뀌어 배정설정 ${affected}건이 삭제됩니다. 계속할까요?`)) return;

  state.rooms = newRooms;
  state.roomMeta = newMeta;
  state.roomRequirements = kept;
  syncRequirements();
  renderRoomList();
  renderExamDayList();
  toast(`고사실 ${state.rooms.length}개 가져오기 완료`);
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
  const header = '고사실명,부감독';
  const rows = state.roomMeta.length
    ? state.roomMeta.map(m => [csvField(m.name), m.isAssistant ? '1' : ''].join(','))
    : [];  // 데이터 없을 때 헤더만
  downloadCSV([header, ...rows].join('\n'), '고사실목록_양식.csv');
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
window.updateExamDay = (idx, key, val) => { state.examDays[idx][key] = val; renderExamDayList(); };
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
  state.rooms.splice(idx, 1);
  state.roomMeta.splice(idx, 1);
  pruneStaleRoomRequirements();
  renderRoomList();
  renderExamDayList();
};
window.removeRole = (idx) => {
  const removedRoleIdx = idx + 1;
  state.roles.splice(idx, 1);
  state.roomRequirements = removeRoleFromRequirements(state.roomRequirements, removedRoleIdx);
  syncRequirements();
  renderRoleList();
};
window.removeExamDay = (idx) => {
  const removedDayIdx = idx + 1;
  state.examDays.splice(idx, 1);
  state.roomRequirements = removeDayFromRequirements(state.roomRequirements, removedDayIdx);
  syncRequirements();
  renderExamDayList();
};

window.addTeacher = () => {
  state.teachers.push({ name: '', prevWorkload: 0, forbiddenRooms: '', unavailableSlots: '', requiredSlotStr: '', requiredRoleStr: '' });
  renderTeacherList();
};
window.addRoom = () => {
  const name = prompt('고사실명을 입력하세요 (예: 101)')?.trim();
  if (!name) return;
  state.rooms.push(name);
  state.roomMeta.push({ name, grade: null, isAssistant: false });
  renderRoomList();
};
window.updateAssistWorkload = (val) => {
  if (state.roles[1]) {
    state.roles[1].workload = val;
  }
};

window.toggleAssistRole = () => {
  if (!state.roles[1]) return;
  state.roles[1].active = state.roles[1].active === false ? true : false;
  renderRoleList();
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

// ─── 오류 모달 ────────────────────────────────────────────────────────────────
// title: 모달 제목
// desc: 상황 설명 (문자열)
// errors: 오류 항목 배열 (선택)
// fix: 수정 방법 안내 (문자열, 선택)
function showErrorModal({ title, desc, errors = [], fix = '' }) {
  const modal = document.getElementById('error-modal');
  if (!modal) { alert(desc + '\n' + errors.join('\n')); return; }

  document.getElementById('error-modal-title').textContent = title;

  let html = '';
  if (desc) {
    html += `<div class="error-modal-section">
      <div class="error-modal-section-title">발생 상황</div>
      <div class="error-modal-desc">${desc.replace(/\n/g, '<br>')}</div>
    </div>`;
  }
  if (errors.length) {
    html += `<div class="error-modal-section">
      <div class="error-modal-section-title">오류 목록 (${errors.length}건)</div>
      <ul class="error-modal-list">${errors.map(e => `<li>${e.replace(/\n/g, '<br>')}</li>`).join('')}</ul>
    </div>`;
  }
  if (fix) {
    html += `<div class="error-modal-section">
      <div class="error-modal-section-title">💡 수정 방법</div>
      <div class="error-modal-fix">${fix.replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  document.getElementById('error-modal-body').innerHTML = html;
  modal.style.display = 'flex';
}

window.closeErrorModal = function(e) {
  if (e?.target === document.getElementById('error-modal')) {
    document.getElementById('error-modal').style.display = 'none';
  }
};

// ─── 초기화 ───────────────────────────────────────────────────────────────────

export function init() {
  initTabs();
  loadAll();
}
