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


// ─── 감독표(전체) XLSX 생성 ───────────────────────────────────────────────────

function buildFullTableSheets({ data, slots, teachers, rooms, roles, examDays }) {
  const tCount = teachers.length;
  const roleCount = roles.length;

  const slotMap = {};
  slots.forEach((s, idx) => { slotMap[`${s.dayIdx}_${s.period}`] = idx + 1; });

  return examDays.map((day, di) => {
    const dayIdx = di + 1;
    const periods = [];
    for (let p = day.startPeriod; p <= day.endPeriod; p++) periods.push(p);

    const colCount = rooms.length + 3;
    const rows = [
      { cells: [`${formatDate(day.date)} 감독 배정표`] },
      { cells: ['교시', '보직', ...rooms, '합계'] },
    ];

    periods.forEach((p) => {
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

        rows.push({
          cells: [
            `${p}교시`,
            abbreviateRole(roles[r - 1]?.name),
            ...rooms.map(room => (cellMap[room] || []).join(', ')),
            Object.values(cellMap).flat().length,
          ],
        });
      }
    });

    return {
      name: safeSheetName(formatDate(day.date) || `${dayIdx}일차`, di),
      colCount,
      rows,
    };
  });
}

function downloadFullTableXLSX(params) {
  const sheets = buildFullTableSheets(params);
  if (!sheets.length) return;

  const files = buildXlsxFiles(sheets);
  const blob = new Blob([zipFiles(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, makeFullTableFilename(params.examDays));
}

function makeFullTableFilename(examDays) {
  const first = (examDays?.[0]?.date || '').replace(/[^0-9]/g, '');
  return `감독표${first ? '_' + first : ''}.xlsx`;
}

function buildXlsxFiles(sheets) {
  const files = {
    '[Content_Types].xml': contentTypesXml(sheets.length),
    '_rels/.rels': relsXml(),
    'docProps/app.xml': appXml(sheets),
    'docProps/core.xml': coreXml(),
    'xl/workbook.xml': workbookXml(sheets),
    'xl/_rels/workbook.xml.rels': workbookRelsXml(sheets.length),
  };
  sheets.forEach((sheet, idx) => {
    files[`xl/worksheets/sheet${idx + 1}.xml`] = worksheetXml(sheet);
  });
  return files;
}

function worksheetXml(sheet) {
  const rows = sheet.rows.map((row, ri) => {
    const r = ri + 1;
    const cells = [];
    for (let ci = 1; ci <= sheet.colCount; ci++) {
      const value = row.cells[ci - 1] ?? '';
      cells.push(cellXml(r, ci, value));
    }
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function cellXml(row, col, value) {
  const ref = cellRef(row, col);
  if (value === '' || value == null) return `<c r="${ref}"/>`;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function contentTypesXml(sheetCount) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheetOverrides}
</Types>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

function appXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>시험감독 배정 시스템</Application>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map(s => `<vt:lpstr>${xmlEscape(s.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>
</Properties>`;
}

function coreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>감독표</dc:title>
  <dc:creator>시험감독 배정 시스템</dc:creator>
  <cp:lastModifiedBy>시험감독 배정 시스템</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function safeSheetName(name, idx) {
  const base = String(name || `${idx + 1}일차`).replace(/[\\/?*\[\]:]/g, ' ').trim() || `${idx + 1}일차`;
  return base.slice(0, 31);
}

function cellRef(row, col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return `${s}${row}`;
}

function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ponytail: XLSX는 ZIP 패키지다. 외부 라이브러리 없이 무압축 ZIP만 생성한다.
function zipFiles(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const { time, date } = dosDateTime(new Date());

    const local = concatBytes(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
      nameBytes, data,
    );
    localParts.push(local);

    const central = concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    );
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length),
    u32(centralSize), u32(offset), u16(0),
  );
  return concatBytes(...localParts, ...centralParts, end);
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }

function concatBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(p => { out.set(p, offset); offset += p.length; });
  return out;
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
  downloadFullTableXLSX,
  buildFullTableHTML,
  buildFullTableSheets,
  buildPersonalTableHTML,
  formatDate,
  ROLE_COLORS,
  stripParens,
};
