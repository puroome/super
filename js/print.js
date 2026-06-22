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

// ─── 감독표(전체) HTML 생성 ───────────────────────────────────────────────────

/**
 * 전체 감독표 HTML 생성
 * 날짜별로 표를 따로 만들어 인쇄 시 한 페이지에 하루씩 나오게 한다.
 * 같은 날짜/같은 교시 행은 rowspan으로 묶어 칸 사이에 선이 끼지 않게 한다.
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

    let html = `<table class="print-table" border="1" cellspacing="0" cellpadding="4">
      <thead><tr>
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
              cellMap[room].push(teachers[i - 1].name);
            }
          }
        }

        const bg = ROLE_COLORS[r] || '#fff';
        html += `<tr style="background:${bg}">`;
        if (pi === 0 && r === 1) html += `<td rowspan="${totalRows}">${formatDate(day.date)}</td>`;
        if (r === 1) html += `<td rowspan="${roleCount}">${p}교시</td>`;
        html += `<td>${abbreviateRole(roles[r - 1]?.name)}</td>
          ${rooms.map(room => `<td>${(cellMap[room] || []).join('<br>')}</td>`).join('')}
          <td>${Object.values(cellMap).flat().length}</td>
        </tr>`;
      }
    });

    html += `</tbody></table>`;
    return html;
  });

  // ponytail: 페이지 구분은 .page-break(인쇄용 page-break-after)로 처리 — 표 자체를 나누지 않고
  //   하루치 표 뒤에 구분자만 넣는 가장 단순한 방식. 하루 표가 한 페이지보다 길면 자동으로
  //   다음 페이지로 흘러간다(고사실/교사 수가 매우 많은 경우의 한계, 별도 축소 로직은 두지 않음).
  return dayTables.join('<div class="page-break"></div>');
}

// ─── 개인 시간표 HTML ─────────────────────────────────────────────────────────

/**
 * 개인 시간표 HTML
 * 보직이 없는 칸(미배정/배정불가 등, roleIdx===0)은 비워서 보여주고,
 * 같은 날짜 행은 rowspan으로 묶는다.
 */
function buildPersonalTableHTML({ data, slots, teacher, teacherIdx, roles, examDays }) {
  let html = `<div class="personal-table">
    <h3>${teacher.name} 선생님 개인 시간표</h3>
    <table border="1" cellspacing="0" cellpadding="6">
    <thead><tr><th>날짜</th><th>교시</th><th>고사장</th><th>보직</th></tr></thead>
    <tbody>`;

  examDays.forEach((day, di) => {
    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);

    periods.forEach((p, pi) => {
      const j = slots.findIndex(s => s.dayIdx === di + 1 && s.period === p) + 1;
      const cell = j > 0 ? String(data[teacherIdx]?.[j] ?? '') : '';
      const roleIdx = extractRole(cell);
      // roleIdx===0이면 미배정/대기/배정불가(0,1,x 등) 칸이므로 비워서 보여준다.
      const room = roleIdx > 0 ? extractRoom(cell) : '';
      const roleName = roleIdx > 0 ? abbreviateRole(roles[roleIdx - 1]?.name) : '';

      html += `<tr>`;
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
 * (예전처럼 별도 창을 띄우고 그 안의 "인쇄" 버튼을 다시 누를 필요 없음)
 *
 * ponytail: 인쇄 대화상자의 "머리글과 바닥글"(좌상단 인쇄 날짜/시간, 좌하단 about:blank 등)은
 *   브라우저 자체 설정이라 코드로 끌 수 없는 영역이다 — 인쇄창에서 "추가 설정 > 머리글과 바닥글"을
 *   한 번 체크 해제하면 보통 그 다음부터는 브라우저가 설정을 기억해 다시 안 보인다.
 */
function printElement(html, title = '감독표') {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      @page { size: landscape; margin: 12mm; }
      body { font-family: 'Malgun Gothic', sans-serif; font-size: 11px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #888; padding: 3px 6px; text-align: center; }
      th { background: #6f7ba0; color: #fff; }
      .page-break { page-break-after: always; }
      .personal-table { margin-bottom: 20px; }
    </style>
  </head><body>${html}</body></html>`);
  doc.close();

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  iframe.contentWindow.onafterprint = () => iframe.remove();
  // 일부 브라우저는 onafterprint가 안 울릴 수 있어 안전망으로 뒤늦게 정리
  setTimeout(() => { if (iframe.parentNode) iframe.remove(); }, 60000);
}

/**
 * 전체 감독표 인쇄 (날짜별로 페이지 분리, 가로방향)
 */
function printFullTable(params) {
  printElement(buildFullTableHTML(params), '감독표(전체)');
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
  printPersonalTable,
  printAllPersonal,
  buildFullTableHTML,
  buildPersonalTableHTML,
  formatDate,
  ROLE_COLORS,
};
