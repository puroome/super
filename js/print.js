// print.js — 출력/PDF

import { extractRole, extractRoom, buildSlots } from './algorithm.js';

const ROLE_COLORS = {
  0: '#ffffff',
  1: '#b0d3d1',
  2: '#f9f998',
  3: '#fea088',
  4: '#f8e3e8',
  5: '#e0d5c6',
};

// ─── 감독표(전체) HTML 생성 ───────────────────────────────────────────────────

/**
 * 전체 감독표 HTML 생성
 * @param {Object} p
 *   data, slots, teachers, rooms, roles, examDays
 * @returns {string} HTML string
 */
function buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays }) {
  const tCount = teachers.length;
  const sCount = slots.length;
  const roleCount = roles.length;

  // 날짜/교시별 행 순서 생성
  // 행: [날짜, 교시, 보직] 조합
  const rows = [];
  examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      for (let r = 1; r <= roleCount; r++) {
        rows.push({ dayIdx: di + 1, period: p, roleIdx: r, date: day.date });
      }
    }
  });

  // 슬롯 → 열 인덱스 맵
  const slotMap = {};
  slots.forEach((s, idx) => {
    slotMap[`${s.dayIdx}_${s.period}`] = idx + 1;
  });

  // 고사실 → 열 인덱스
  const roomColMap = {};
  rooms.forEach((room, idx) => { roomColMap[room] = idx; });

  // 테이블 헤더
  let html = `<table class="print-table" border="1" cellspacing="0" cellpadding="4">`;
  html += `<thead><tr>
    <th>날짜</th><th>교시</th><th>보직</th>
    ${rooms.map(r => `<th>${r}</th>`).join('')}
    <th>합계</th>
  </tr></thead><tbody>`;

  let prevDay = -1, prevPeriod = -1;

  rows.forEach(row => {
    const j = slotMap[`${row.dayIdx}_${row.period}`];
    if (!j) return;

    const cellMap = {};
    rooms.forEach(r => { cellMap[r] = []; });

    for (let i = 1; i <= tCount; i++) {
      const cell = String(data[i]?.[j] ?? '');
      const r = extractRole(cell);
      const room = extractRoom(cell);
      if (r === row.roleIdx && room && cellMap[room] !== undefined) {
        cellMap[room].push(teachers[i - 1].name);
      }
    }

    const dateStr = formatDate(row.date);
    const showDate = prevDay !== row.dayIdx;
    const showPeriod = prevPeriod !== row.period || prevDay !== row.dayIdx;
    prevDay = row.dayIdx;
    prevPeriod = row.period;

    const bg = ROLE_COLORS[row.roleIdx] || '#fff';
    html += `<tr style="background:${bg}">
      <td>${showDate ? dateStr : ''}</td>
      <td>${showPeriod ? row.period + '교시' : ''}</td>
      <td>${roles[row.roleIdx - 1]?.name ?? ''}</td>
      ${rooms.map(room => `<td>${(cellMap[room] || []).join('<br>')}</td>`).join('')}
      <td>${Object.values(cellMap).flat().length}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

// ─── 개인 시간표 HTML ─────────────────────────────────────────────────────────

function buildPersonalTableHTML({ data, slots, teacher, teacherIdx, roles, examDays }) {
  const sCount = slots.length;
  let html = `<div class="personal-table">
    <h3>${teacher.name} 선생님 개인 시간표</h3>
    <table border="1" cellspacing="0" cellpadding="6">
    <thead><tr><th>날짜</th><th>교시</th><th>고사장[보직]</th><th>보직명</th></tr></thead>
    <tbody>`;

  let prevDate = '';
  examDays.forEach((day, di) => {
    for (let p = day.startPeriod; p <= day.endPeriod; p++) {
      const j = slots.findIndex(s => s.dayIdx === di + 1 && s.period === p) + 1;
      const cell = j > 0 ? String(data[teacherIdx]?.[j] ?? '') : '';
      const roleIdx = extractRole(cell);
      const room = extractRoom(cell);
      const roleName = roleIdx > 0 ? (roles[roleIdx - 1]?.name ?? '') : '';
      const dateStr = formatDate(day.date);
      const showDate = dateStr !== prevDate;
      prevDate = dateStr;

      html += `<tr>
        <td>${showDate ? dateStr : ''}</td>
        <td>${p}교시</td>
        <td>${room ? `${room}[${roleIdx}]` : ''}</td>
        <td>${roleName}</td>
      </tr>`;
    }
  });

  html += `</tbody></table></div>`;
  return html;
}

// ─── 일별 감독표 ─────────────────────────────────────────────────────────────

function buildDailyTablesHTML(params) {
  const { examDays } = params;
  return examDays.map((day, di) => {
    const singleDay = { ...params, examDays: [day], slots: params.slots.filter(s => s.dayIdx === di + 1) };
    // dayIdx를 1로 재매핑
    const remappedData = remapDataForDay(params.data, params.slots, di + 1, params.teachers.length);
    return buildFullTableHTML({ ...singleDay, data: remappedData });
  }).join('<div class="page-break"></div>');
}

function remapDataForDay(data, slots, dayIdx, tCount) {
  const dayCols = slots.map((s, idx) => s.dayIdx === dayIdx ? idx + 1 : -1).filter(j => j > 0);
  const newData = [];
  for (let i = 0; i <= tCount; i++) {
    newData[i] = [''];
    dayCols.forEach((j, newJ) => { newData[i][newJ + 1] = data[i]?.[j] ?? ''; });
  }
  return newData;
}

// ─── 인쇄 ────────────────────────────────────────────────────────────────────

function printElement(html, title = '감독표') {
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; font-size: 11px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #888; padding: 3px 6px; text-align: center; }
      th { background: #6f7ba0; color: white; }
      .page-break { page-break-after: always; }
      .personal-table { margin-bottom: 20px; }
      @media print { .no-print { display: none; } }
    </style>
  </head><body>
    <button class="no-print" onclick="window.print()" style="margin-bottom:10px">🖨️ 인쇄</button>
    ${html}
  </body></html>`);
  w.document.close();
}

/**
 * 전체 감독표 인쇄
 */
function printFullTable(params) {
  printElement(buildFullTableHTML(params), '감독표(전체)');
}

/**
 * 일별 감독표 인쇄
 */
function printDailyTable(params) {
  printElement(buildDailyTablesHTML(params), '감독표(일별)');
}

/**
 * 특정 교사 개인 시간표 인쇄
 */
function printPersonalTable(params) {
  printElement(buildPersonalTableHTML(params), `${params.teacher.name} 개인시간표`);
}

/**
 * 전체 교사 개인 시간표 일괄 인쇄
 */
function printAllPersonal({ data, slots, teachers, roles, examDays }) {
  const html = teachers.map((teacher, idx) =>
    buildPersonalTableHTML({ data, slots, teacher, teacherIdx: idx + 1, roles, examDays })
  ).join('<div class="page-break"></div>');
  printElement(html, '개인시간표(전체)');
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export {
  printFullTable,
  printDailyTable,
  printPersonalTable,
  printAllPersonal,
  buildFullTableHTML,
  buildPersonalTableHTML,
  formatDate,
  ROLE_COLORS,
};
