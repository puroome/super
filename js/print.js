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
// ponytail: 한글·영문 괄호 모두 제거. 괄호가 중첩되거나 내용이 비어있어도 안전하게 처리됨.
function stripParens(name) {
  return String(name ?? '').replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

// ─── 감독표(전체) HTML 생성 ───────────────────────────────────────────────────

/**
 * 전체 감독표 HTML 생성
 * 날짜별로 표를 따로 만들어 인쇄 시 한 페이지에 하루씩 나오게 한다.
 * 같은 날짜/같은 교시 행은 rowspan으로 묶어 칸 사이에 선이 끼지 않게 한다.
 *
 * 인쇄 시 하루치 표가 정확히 한 페이지에 들어가도록 각 표를 .day-page 컨테이너로 감싸고,
 * CSS transform:scale()로 가로·세로 모두 페이지 안에 맞게 줄인다.
 * ponytail: scale 계산은 브라우저 인쇄 엔진에서 실행되므로 JS로 동적 계산하지 않고
 *   "인쇄 영역 대비 표 크기" 비율을 CSS에서 처리한다.
 *   실제 fit-to-page는 CSS @page + .day-page 높이 100vh + overflow:hidden 조합으로 구현.
 *   표가 매우 좁거나(고사실 3개 미만) 매우 넓은(고사실 20개 이상) 극단 케이스는
 *   브라우저 인쇄 대화상자의 "페이지에 맞춤" 옵션으로 보완을 권장한다.
 */
function buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays }) {
  const tCount = teachers.length;
  const roleCount = roles.length;

  const slotMap = {};
  slots.forEach((s, idx) => { slotMap[`${s.dayIdx}_${s.period}`] = idx + 1; });

  const dayTables = examDays.map((day, di) => {
    const dayIdx = di + 1;
    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);
    const totalRows = periods.length * roleCount;

    // 헤더 배경: rgba(0,0,0,0.3) = 투명도 70% 검정 (옅은 회색)
    const headerBg = 'rgba(0,0,0,0.3)';

    let tableHtml = `<table class="print-table" border="1" cellspacing="0" cellpadding="4">
      <thead><tr style="background:${headerBg};color:#fff">
        <th>날짜</th><th>교시</th><th>보직</th>
        ${rooms.map(r => `<th>${r}</th>`).join('')}
        <th>합계</th>
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
        if (pi === 0 && r === 1) tableHtml += `<td rowspan="${totalRows}">${formatDate(day.date)}</td>`;
        if (r === 1) tableHtml += `<td rowspan="${roleCount}">${p}교시</td>`;
        tableHtml += `<td>${abbreviateRole(roles[r - 1]?.name)}</td>
          ${rooms.map(room => `<td>${(cellMap[room] || []).join('<br>')}</td>`).join('')}
          <td>${Object.values(cellMap).flat().length}</td>
        </tr>`;
      }
    });

    tableHtml += `</tbody></table>`;

    // .day-page: 하루치 표를 한 인쇄 페이지 안에 가두는 컨테이너
    return `<div class="day-page">${tableHtml}</div>`;
  });

  return dayTables.join('');
}

// ─── 개인 시간표 HTML ─────────────────────────────────────────────────────────

/**
 * 개인 시간표 HTML
 * 짝수 번째 시험일(0-based index 1, 3, 5…)은 배경을 rgba(0,0,0,0.15) ≒ 투명도 85% 검정으로.
 * 보직이 없는 칸(roleIdx===0)은 비워서 보여주고, 같은 날짜 행은 rowspan으로 묶는다.
 */
function buildPersonalTableHTML({ data, slots, teacher, teacherIdx, roles, examDays }) {
  const headerBg = 'rgba(0,0,0,0.3)';

  let html = `<div class="personal-table">
    <h3>${stripParens(teacher.name)} 선생님 개인 시간표</h3>
    <table border="1" cellspacing="0" cellpadding="6">
    <thead><tr style="background:${headerBg};color:#fff"><th>날짜</th><th>교시</th><th>고사장</th><th>보직</th></tr></thead>
    <tbody>`;

  examDays.forEach((day, di) => {
    // 짝수 번째 날짜(1번째, 3번째…, 0-based index 1, 3)에 배경색 적용
    // ponytail: di % 2 === 1 이 "두 번째, 네 번째…" = 짝수 번째
    const rowBg = di % 2 === 1 ? 'background:rgba(0,0,0,0.15)' : '';

    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);

    periods.forEach((p, pi) => {
      const j = slots.findIndex(s => s.dayIdx === di + 1 && s.period === p) + 1;
      const cell = j > 0 ? String(data[teacherIdx]?.[j] ?? '') : '';
      const roleIdx = extractRole(cell);
      const room = roleIdx > 0 ? extractRoom(cell) : '';
      const roleName = roleIdx > 0 ? abbreviateRole(roles[roleIdx - 1]?.name) : '';

      html += `<tr style="${rowBg}">`;
      if (pi === 0) html += `<td rowspan="${periods.length}">${formatDate(day.date)}</td>`;
      html += `<td>${p}교시</td><td>${room}</td><td>${roleName}</td></tr>`;
    });
  });

  html += `</tbody></table></div>`;
  return html;
}

// ─── 인쇄 ────────────────────────────────────────────────────────────────────

/**
 * 보이지 않는 iframe에 인쇄용 HTML을 그려서 바로 인쇄 대화상자를 띄운다.
 */
function printElement(html, title = '감독표', isFullTable = false) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  // 전체감독표 전용 CSS: .day-page를 정확히 한 인쇄 페이지에 맞춤
  // ponytail: fit-content를 위해 transform-origin:top left + scale(1) 기본값을 두고,
  //   실제 축소는 브라우저의 "페이지에 맞춤" 인쇄 옵션에 위임한다.
  //   day-page에 page-break-after:always를 걸어 하루치가 반드시 새 페이지로 넘어가게 한다.
  //   overflow:hidden으로 표가 컨테이너 밖으로 삐져나가지 않게 막는다.
  const fullTableStyles = isFullTable ? `
    @page { size: landscape; margin: 8mm; }
    .day-page {
      page-break-after: always;
      page-break-inside: avoid;
      width: 100%;
      overflow: hidden;
    }
    .day-page:last-child { page-break-after: auto; }
    .print-table {
      width: 100%;
      table-layout: fixed;
    }
    .print-table td, .print-table th {
      word-break: break-all;
      overflow: hidden;
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
      th, td { border: 1px solid #888; padding: 3px 6px; text-align: center; }
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

/**
 * 전체 감독표 인쇄 (날짜별로 페이지 분리, 가로방향)
 */
function printFullTable(params) {
  printElement(buildFullTableHTML(params), '감독표(전체)', true);
}

/**
 * 특정 교사 개인 시간표 인쇄
 */
function printPersonalTable(params) {
  printElement(buildPersonalTableHTML(params), `${stripParens(params.teacher.name)} 개인시간표`, false);
}

/**
 * 전체 교사 개인 시간표 일괄 인쇄
 */
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
