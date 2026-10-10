/* export.js — CSV / XLSX download helpers. Uses SheetJS when available, otherwise CSV. */
(function (root) {
  'use strict';
  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }
  function download(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  /** sheets: [{ name, rows: [[...],[...]] }] */
  function workbook(baseName, sheets) {
    if (root.XLSX) {
      const wb = root.XLSX.utils.book_new();
      sheets.forEach((s) => {
        const ws = root.XLSX.utils.aoa_to_sheet(s.rows);
        ws['!cols'] = (s.rows[0] || []).map((_, i) => ({ wch: Math.min(40, Math.max(8, ...s.rows.map((r) => String(r[i] == null ? '' : r[i]).length + 2))) }));
        root.XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
      });
      root.XLSX.writeFile(wb, `${baseName}.xlsx`);
      return 'xlsx';
    }
    sheets.forEach((s) => download(`${baseName}${sheets.length > 1 ? '-' + s.name.replace(/\W+/g, '_') : ''}.csv`, '﻿' + toCsv(s.rows), 'text/csv;charset=utf-8'));
    return 'csv';
  }
  root.Exporter = { toCsv, download, workbook };
})(typeof self !== 'undefined' ? self : this);
