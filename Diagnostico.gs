/**
 * DIAGNÓSTICO DE CELDAS
 *
 * Google Sheets tiene un tope DURO de 10.000.000 de celdas por libro (sumando
 * TODAS las pestañas). No es un límite de Apps Script: es del propio Sheets,
 * y una vez cerca, todo va lento (carga, cálculo, y también los scripts) y
 * cualquier importación nueva puede fallar aunque sea pequeña.
 *
 * "Celdas reservadas" (getMaxRows x getMaxColumns) casi siempre es MUCHO más
 * grande que "celdas con datos" (getLastRow x getLastColumn): una hoja se
 * queda con miles de filas/columnas vacías pero reservadas (herencia de
 * pegados antiguos, formato aplicado a rangos enormes, etc.) y esas cuentan
 * igual para el límite de 10M, aunque estén en blanco.
 */
function diagnosticoCeldas() {
  const ss = SpreadsheetApp.getActive();
  const hojas = ss.getSheets();

  let totalReservado = 0, totalUsado = 0;
  const filas = hojas.map(h => {
    const nombre = h.getName();
    const maxF = h.getMaxRows(), maxC = h.getMaxColumns();
    const usF = h.getLastRow(), usC = h.getLastColumn();
    const reservado = maxF * maxC;
    const usado = usF * usC;
    totalReservado += reservado;
    totalUsado += usado;
    return { nombre, maxF, maxC, usF, usC, reservado, usado, sobrante: reservado - usado };
  }).sort((a, b) => b.sobrante - a.sobrante);

  let html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222">' +
    '<p style="margin:0 0 10px"><b>Total reservado: ' + totalReservado.toLocaleString('es-ES') +
    ' celdas</b> de 10.000.000 (' + (totalReservado / 10000000 * 100).toFixed(1) + '%)' +
    '<br>Total con datos de verdad: ' + totalUsado.toLocaleString('es-ES') + ' celdas' +
    '<br><b style="color:#c00">Sobrante reservado sin usar: ' + (totalReservado - totalUsado).toLocaleString('es-ES') + ' celdas</b></p>' +
    '<table style="border-collapse:collapse;width:100%"><tr style="background:#333;color:#fff">' +
    '<th style="padding:4px 6px;text-align:left">Hoja</th>' +
    '<th style="padding:4px 6px">Reservado (filas×col)</th>' +
    '<th style="padding:4px 6px">Con datos (filas×col)</th>' +
    '<th style="padding:4px 6px">Sobrante</th></tr>';
  filas.forEach((f, i) => {
    const bg = f.sobrante > 500000 ? '#fdecea' : (i % 2 ? '#f7f7f7' : '#fff');
    html += '<tr style="background:' + bg + '">' +
      '<td style="padding:3px 6px;border-bottom:1px solid #ddd">' + f.nombre + '</td>' +
      '<td style="padding:3px 6px;border-bottom:1px solid #ddd;text-align:right">' + f.maxF.toLocaleString('es-ES') + ' × ' + f.maxC + ' = ' + f.reservado.toLocaleString('es-ES') + '</td>' +
      '<td style="padding:3px 6px;border-bottom:1px solid #ddd;text-align:right">' + f.usF.toLocaleString('es-ES') + ' × ' + f.usC + ' = ' + f.usado.toLocaleString('es-ES') + '</td>' +
      '<td style="padding:3px 6px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold">' + f.sobrante.toLocaleString('es-ES') + '</td>' +
      '</tr>';
  });
  html += '</table></div>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(680).setHeight(500),
    '📊 Celdas reservadas por hoja (mayor sobrante primero)'
  );

  return 'Total reservado: ' + totalReservado + ' / 10.000.000';
}

/**
 * Recorta cada hoja a su rango de datos real + un margen (100 filas / 5 col),
 * liberando las celdas reservadas de más. NO toca el contenido, solo el
 * tamaño de la cuadrícula. Pide confirmación antes de tocar nada.
 */
function recortarHojasAlContenido() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const MARGEN_FILAS = 100, MARGEN_COLS = 5;

  const hojas = ss.getSheets();
  const candidatas = hojas.map(h => {
    const maxF = h.getMaxRows(), maxC = h.getMaxColumns();
    const usF = Math.max(h.getLastRow(), 1), usC = Math.max(h.getLastColumn(), 1);
    const objF = usF + MARGEN_FILAS, objC = usC + MARGEN_COLS;
    return { h, nombre: h.getName(), maxF, maxC, objF, objC,
      libera: (maxF * maxC) - (Math.min(maxF, objF) * Math.min(maxC, objC)) };
  }).filter(c => c.libera > 0).sort((a, b) => b.libera - a.libera);

  if (!candidatas.length) {
    ui.alert('Nada que recortar: todas las hojas ya están ajustadas a su contenido.');
    return 'sin cambios';
  }

  const totalLibera = candidatas.reduce((s, c) => s + c.libera, 0);
  const resumen = candidatas.slice(0, 15).map(c =>
    '· ' + c.nombre + ': ' + c.maxF + '×' + c.maxC + ' → ' + Math.min(c.maxF, c.objF) + '×' + Math.min(c.maxC, c.objC) +
    ' (libera ' + c.libera.toLocaleString('es-ES') + ')'
  ).join('\n');

  const r = ui.alert('Recortar ' + candidatas.length + ' hoja(s)',
    'Se va a reducir el tamaño de la cuadrícula (NO el contenido) de:\n\n' + resumen +
    (candidatas.length > 15 ? '\n… y ' + (candidatas.length - 15) + ' más' : '') +
    '\n\nTotal celdas liberadas: ' + totalLibera.toLocaleString('es-ES') +
    '\n\n¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return 'cancelado';

  let hechas = 0;
  candidatas.forEach(c => {
    try {
      if (c.maxF > c.objF) c.h.deleteRows(c.objF + 1, c.maxF - c.objF);
      if (c.maxC > c.objC) c.h.deleteColumns(c.objC + 1, c.maxC - c.objC);
      hechas++;
    } catch (e) { /* si alguna hoja da error (p.ej. protegida), se salta */ }
  });

  const msg = hechas + ' hoja(s) recortadas · ' + totalLibera.toLocaleString('es-ES') + ' celdas liberadas.';
  ss.toast(msg, '✂️ Recorte', 8);
  return msg;
}
