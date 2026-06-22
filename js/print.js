// print.js — 출력/PDF

import { extractRole, extractRoom } from './algorithm.js';

const ROLE_COLORS = {
  0: '#ffffff',
  1: '#b0d3d1',
  2: '#f9f998',
  3: '#fea088',
  4: '#f8e3e8',
  5: '#e0d5c6',
};

// 출력물에서만 보직명을 줄여서 표시 (정감독→정, 부감독→부). 등록 안 된 이름은 그대로 둔다.
function abbreviateRole(name) {
  if (name === '정감독') return '정';
  if (name === '부감독') return '부';
  return name ?? '';
}

// 인쇄용 교사명 정규화: (순회), (보건), (음악) 등 괄호 정보 제거
function stripParens(name) {
  return String(name ?? '').replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

// ─── 감독표(전체) HTML 생성 ───────────────────────────────────────────────────

/**
 * 전체 감독표 HTML 생성
 * - 날짜열 제거, 대신 표 위에 날짜를 제목으로 출력
 * - 고사실명이 숫자로만 이루어진 경우 세로쓰기(writing-mode)로 모든 digit이 아래로 나오게 함
 * - letter-spacing을 줄여 셀 높이 절약
 * - 헤더 배경: rgba(0,0,0,0.3), 폰트: 검정(#000)
 */
function buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays }) {
  const tCount = teachers.length;
  const roleCount = roles.length;

  const slotMap = {};
  slots.forEach((s, idx) => { slotMap[`${s.dayIdx}_${s.period}`] = idx + 1; });

  // 헤더 배경: 투명도 70% 검정(옅은 회색), 폰트는 검정
  const headerBg = 'rgba(0,0,0,0.3)';

  const dayTables = examDays.map((day, di) => {
    const dayIdx = di + 1;
    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);
    const totalRows = periods.length * roleCount;

    // 날짜를 표 위 제목으로 — 날짜열은 표에서 제거
    const dayTitle = `<div class="day-title">${formatDate(day.date)} 감독 배정표</div>`;

    let tableHtml = `<table class="print-table" border="1" cellspacing="0" cellpadding="4">
      <thead><tr style="background:${headerBg};color:#000">
        <th class="h-text">교시</th><th class="h-text">보직</th>
        ${rooms.map(r => `<th>${r}</th>`).join('')}
        <th class="h-text">합계</th>
      </tr></thead><tbody>`;

    periods.forEach((p, pi) => {
      const j = slotMap[`${dayIdx}_${p}`];

      for (let r = 1; r <= roleCount; r++) {
        const cellMap = {};
        rooms.forEach(rm => { cellMap[rm] = []; });

        if (j) {
          for (let i = 1; i <= tCount; i++) {
            const cell = String(data[i]?.[j] ?? '');
            const role = extractRole(cell);
            const room = extractRoom(cell);
            if (role === r && room && cellMap[room] !== undefined) {
              cellMap[room].push(stripParens(teachers[i - 1].name));
            }
          }
        }

        const bg = ROLE_COLORS[r] || '#fff';
        tableHtml += `<tr style="background:${bg}">`;
        // 날짜열 제거 — 교시는 보직 수만큼 rowspan
        if (r === 1) tableHtml += `<td rowspan="${roleCount}">${p}교시</td>`;
        tableHtml += `<td>${abbreviateRole(roles[r - 1]?.name)}</td>
          ${rooms.map(room => `<td>${(cellMap[room] || []).join('<br>')}</td>`).join('')}
          <td>${Object.values(cellMap).flat().length}</td>
        </tr>`;
      }
    });

    tableHtml += `</tbody></table>`;
    return `<div class="day-page">${dayTitle}${tableHtml}</div>`;
  });

  return dayTables.join('');
}

// ─── 개인 시간표 HTML ─────────────────────────────────────────────────────────

/**
 * 개인 시간표 HTML
 * - 짝수 번째 시험일(di % 2 === 1)의 모든 행: rgba(0,0,0,0.15) 배경
 * - 날짜 rowspan td에도 같은 배경 적용
 * - 헤더 배경: rgba(0,0,0,0.3), 폰트: 검정(#000)
 */
function buildPersonalTableHTML({ data, slots, teacher, teacherIdx, roles, examDays }) {
  const headerBg = 'rgba(0,0,0,0.3)';

  let html = `<div class="personal-table">
    <h3>${stripParens(teacher.name)} 선생님 개인 시간표</h3>
    <table border="1" cellspacing="0" cellpadding="6">
    <thead><tr style="background:${headerBg};color:#000"><th>날짜</th><th>교시</th><th>고사장</th><th>보직</th></tr></thead>
    <tbody>`;

  examDays.forEach((day, di) => {
    // ponytail: di % 2 === 1 → 두 번째, 네 번째… 시험일 = "짝수 번째"
    // rowspan td와 일반 td 모두 동일한 style을 써야 배경이 날짜 칸에도 적용됨
    const evenBg = di % 2 === 1 ? 'background:rgba(0,0,0,0.15)' : '';

    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);

    periods.forEach((p, pi) => {
      const j = slots.findIndex(s => s.dayIdx === di + 1 && s.period === p) + 1;
      const cell = j > 0 ? String(data[teacherIdx]?.[j] ?? '') : '';
      const roleIdx = extractRole(cell);
      const room = roleIdx > 0 ? extractRoom(cell) : '';
      const roleName = roleIdx > 0 ? abbreviateRole(roles[roleIdx - 1]?.name) : '';

      html += `<tr>`;
      // 날짜 칸도 같은 배경을 명시적으로 지정해야 rowspan 셀에도 적용됨
      if (pi === 0) html += `<td rowspan="${periods.length}" style="${evenBg}">${formatDate(day.date)}</td>`;
      html += `<td style="${evenBg}">${p}교시</td>`;
      html += `<td style="${evenBg}">${room}</td>`;
      html += `<td style="${evenBg}">${roleName}</td>`;
      html += `</tr>`;
    });
  });

  html += `</tbody></table></div>`;
  return html;
}

// ─── 인쇄 ────────────────────────────────────────────────────────────────────

function printElement(html, title = '감독표', isFullTable = false) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const fullTableStyles = isFullTable ? `
    @page { size: landscape; margin: 8mm; }
    .day-page {
      page-break-after: always;
      page-break-inside: avoid;
      width: 100%;
    }
    .day-page:last-child { page-break-after: auto; }
    .day-title {
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 4px;
    }
    .print-table {
      width: 100%;
      table-layout: fixed;
    }
    /* 숫자로만 된 고사실명: 모든 digit이 세로로 쌓이도록 */
    /* ponytail: writing-mode:vertical-rl은 글자를 오른쪽→왼쪽으로 쌓아
       text-orientation:mixed와 함께 쓰면 숫자도 눕지 않고 세로로 나옴.
       글자 간격도 -0.05em으로 좁힘. */
    .print-table th {
      writing-mode: vertical-rl;
      text-orientation: mixed;
      letter-spacing: -0.05em;
      white-space: nowrap;
      padding: 4px 2px;
    }
    /* 교시·보직·합계 열은 세로쓰기 불필요, 별도 class로 override */
    .print-table th.h-text {
      writing-mode: horizontal-tb;
      letter-spacing: normal;
    }
    .print-table td, .print-table th {
      overflow: hidden;
      font-size: 9px;
      letter-spacing: -0.05em;
    }
  ` : `
    @page { size: landscape; margin: 12mm; }
    .personal-table { margin-bottom: 20px; page-break-after: always; }
    .personal-table:last-child { page-break-after: auto; }
  `;

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; font-size: 11px; margin: 0; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #888; padding: 3px 6px; text-align: center; vertical-align: middle; }
      th { font-weight: 600; }
      h3 { font-size: 13px; margin-bottom: 6px; }
      ${fullTableStyles}
    </style>
  </head><body>${html}</body></html>`);
  doc.close();

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  iframe.contentWindow.onafterprint = () => iframe.remove();
  setTimeout(() => { if (iframe.parentNode) iframe.remove(); }, 60000);
}

function printFullTable(params) {
  printElement(buildFullTableHTML(params), '감독표(전체)', true);
}

function printPersonalTable(params) {
  printElement(buildPersonalTableHTML(params), `${stripParens(params.teacher.name)} 개인시간표`, false);
}

function printAllPersonal({ data, slots, teachers, roles, examDays }) {
  const html = teachers.map((teacher, idx) =>
    buildPersonalTableHTML({ data, slots, teacher, teacherIdx: idx + 1, roles, examDays })
  ).join('');
  printElement(html, '개인시간표(전체)', false);
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
  printPersonalTable,
  printAllPersonal,
  buildFullTableHTML,
  buildPersonalTableHTML,
  formatDate,
  ROLE_COLORS,
  stripParens,
};
