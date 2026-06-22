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

function abbreviateRole(name) {
  if (name === '정감독') return '정';
  if (name === '부감독') return '부';
  return name ?? '';
}

function stripParens(name) {
  return String(name ?? '').replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

// 고사실 헤더용: 괄호를 <span class="paren">으로 감싸 눕힘 처리
// ponytail: text-orientation:upright(직립)에서 괄호만 mixed(눕힘)로 바꾸려면
//   해당 문자를 별도 span으로 감싸는 수밖에 없다.
function wrapParens(str) {
  return String(str).replace(/[()（）]/g, c => `<span class="paren">${c}</span>`);
}

// ─── 감독표(전체) HTML 생성 ───────────────────────────────────────────────────

function buildFullTableHTML({ data, slots, teachers, rooms, roles, examDays }) {
  const tCount = teachers.length;
  const roleCount = roles.length;

  const slotMap = {};
  slots.forEach((s, idx) => { slotMap[`${s.dayIdx}_${s.period}`] = idx + 1; });

  const headerBg = 'rgba(0,0,0,0.3)';

  const dayTables = examDays.map((day, di) => {
    const dayIdx = di + 1;
    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);

    const dayTitle = `<div class="day-title">${formatDate(day.date)} 감독 배정표</div>`;

    let tableHtml = `<table class="print-table" border="1" cellspacing="0" cellpadding="4">
      <thead><tr style="background:${headerBg};color:#000">
        <th class="h-text">교시</th><th class="h-text">보직</th>
        ${rooms.map(r => `<th>${wrapParens(r)}</th>`).join('')}
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

function buildPersonalTableHTML({ data, slots, teacher, teacherIdx, roles, examDays }) {
  const headerBg = 'rgba(0,0,0,0.3)';

  let html = `<div class="personal-table">
    <h3>${stripParens(teacher.name)} 선생님 개인 시간표</h3>
    <table border="1" cellspacing="0" cellpadding="6">
    <thead><tr style="background:${headerBg};color:#000"><th>날짜</th><th>교시</th><th>고사장</th><th>보직</th></tr></thead>
    <tbody>`;

  examDays.forEach((day, di) => {
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
    /* 고사실 헤더: 세로쓰기 + 직립(숫자·한글 세로로 쌓임)
       ponytail: 세로쓰기에서 letter-spacing = 글자 사이 '세로' 간격.
         text-orientation:upright에서 숫자(1,0…)는 좁은 가로폭이 세로 간격으로
         쓰여 글자가 겹친다(normal=0이라 안 벌어짐). 양수로 강제로 벌려야 한다.
         3px ≈ 한글은 살짝 여유·숫자는 안 겹침. 숫자가 여전히 닿으면 이 값을 키울 것. */
    .print-table th {
      writing-mode: vertical-rl;
      text-orientation: upright;
      letter-spacing: 3px;
      line-height: 1.8;
      white-space: nowrap;
      padding: 4px 2px;
      font-size: 9px;
    }
    /* 괄호만 눕힘 */
    .print-table th span.paren {
      text-orientation: mixed;
    }
    /* 교시·보직·합계 열: 가로쓰기 (세로 간격 보정 불필요) */
    .print-table th.h-text {
      writing-mode: horizontal-tb;
      text-orientation: mixed;
      letter-spacing: normal;
    }
    /* 교사명 데이터 셀: 가로쓰기. 좁은 칸에 이름을 더 잘 욱여넣도록 살짝 더 좁힘.
       ponytail: 한글은 자체 여백이 있어 -0.1em까지는 안 겹친다. 더 줄이면 위험. */
    .print-table td {
      overflow: hidden;
      font-size: 9px;
      letter-spacing: -0.1em;
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
