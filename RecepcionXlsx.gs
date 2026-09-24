/**
 * RECEPCIÓN — XLSX AUTOMÁTICO
 * El informe de facturación (facturacion-informe-*.xlsx) encaja columna a
 * columna con TOP: Pedido (0) -> A, Tienda (2) -> C, Re-Tránsito (33) -> AH.
 * Ver docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md, 4.2.
 *
 * Dos trampas comprobadas contra el archivo real:
 *   1. Los números llegan crudos ("8.1402761E7"), no formateados como al
 *      pegar desde Excel -> hay que pasarlos a entero como texto.
 *   2. La tienda ("014") puede perder el cero a la izquierda al convertir el
 *      xlsx a hoja de cálculo -> se rellena a 3 dígitos.
 *
 * SIN carátula y SIN envío a HODOS (decisión del usuario): Recepción es
 * retención en plataforma, no arrastre.
 */

const RECEPCION_XLSX_ANCHO = 36;
const RECEPCION_XLSX_COL_PEDIDO = 0;
const RECEPCION_XLSX_COL_TIENDA = 2;
const RECEPCION_XLSX_COL_RETRANSITO = 33;

/** "8.1402761E7" / 81402761 (número) / "81402761" -> "81402761". No numérico: se deja igual. */
function _enteroTextoRecepcion_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!isFinite(n)) return t_(v);
  return String(Math.round(n));
}

/** 14 / "14" / "014" -> "014". No numérico: se deja igual (t_ recorta espacios). */
function _tiendaTresDigitos_(v) {
  const s = t_(v);
  if (s === '') return '';
  const n = Number(s);
  if (!isFinite(n)) return s;
  return ('000' + Math.round(n)).slice(-3);
}

/**
 * Decodifica el XLSX y lo vuelca en TOP (sin procesar todavía). Devuelve
 * { filas } o { error } si la cabecera no trae "Pedido" en la columna 0 o
 * "Re-Tránsito" en la 33 (señal de que Leroy Merlin cambió el informe) — en
 * ese caso NO toca TOP. Compartido por la versión de diálogo y la de la web
 * (mismo motivo que _volcarCsvArrastreEnTOP_ en ArrastreCsv.gs).
 */
function _volcarXlsxRecepcionEnTOP_(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, nombreArchivo);
  const filasXlsx = _leerXlsxComoValores_(blob);
  if (!filasXlsx || filasXlsx.length < 2) return { error: 'El archivo está vacío o solo trae la cabecera.' };

  const cab = filasXlsx[0];
  if (t_(cab[RECEPCION_XLSX_COL_PEDIDO]) !== 'Pedido' || t_(cab[RECEPCION_XLSX_COL_RETRANSITO]) !== 'Re-Tránsito') {
    return { error: 'El informe ha cambiado de formato: falta "Pedido" en la columna A o "Re-Tránsito" en la AH.' };
  }

  const filas = [];
  for (let i = 1; i < filasXlsx.length; i++) {
    const f = filasXlsx[i];
    if (t_(f[RECEPCION_XLSX_COL_PEDIDO]) === '') continue; // fila vacía: se descarta
    const fila = new Array(RECEPCION_XLSX_ANCHO).fill('');
    for (let c = 0; c < RECEPCION_XLSX_ANCHO && c < f.length; c++) fila[c] = t_(f[c]);
    fila[RECEPCION_XLSX_COL_PEDIDO] = _enteroTextoRecepcion_(f[RECEPCION_XLSX_COL_PEDIDO]);
    fila[RECEPCION_XLSX_COL_TIENDA] = _tiendaTresDigitos_(f[RECEPCION_XLSX_COL_TIENDA]);
    filas.push(fila);
  }
  if (!filas.length) return { error: 'Ninguna fila trae Pedido.' };

  const cabeceraProvisional = new Array(RECEPCION_XLSX_ANCHO).fill(''); // procesarRecepcion pone sus propios títulos
  const matriz = [cabeceraProvisional].concat(filas);

  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), RECEPCION_XLSX_ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();

  const rango = wsTOP.getRange(1, 1, matriz.length, RECEPCION_XLSX_ANCHO);
  rango.setNumberFormat('@');
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, RECEPCION_XLSX_ANCHO).setFontWeight('bold');

  return { filas: filas.length };
}

/**
 * Vuelca el XLSX en TOP y llama a procesarRecepcion(). Devuelve
 * { filas, resumenProceso } o { error }. Uso: diálogo del menú/panel.
 */
function procesarXlsxRecepcion(base64, nombreArchivo) {
  const v = _volcarXlsxRecepcionEnTOP_(base64, nombreArchivo);
  if (v.error) return v;
  const resumenProceso = procesarRecepcion();
  return { filas: v.filas, resumenProceso: resumenProceso };
}

/**
 * Igual que procesarXlsxRecepcion(), pero para la web: llama a
 * procesarRecepcionWeb() (sin showModalDialog) y devuelve también el HTML de
 * impresión para que el cliente lo abra con window.open + document.write.
 */
function procesarXlsxRecepcionWeb(base64, nombreArchivo) {
  const v = _volcarXlsxRecepcionEnTOP_(base64, nombreArchivo);
  if (v.error) return v;
  const r = procesarRecepcionWeb();
  if (r.error) return { error: r.error };
  return { filas: v.filas, resumenProceso: r.mensaje, htmlImpresion: r.htmlImpresion };
}

/** Abre el diálogo de subida del XLSX (menú y panel). */
function abrirRecepcionXlsx() {
  const html = HtmlService.createHtmlOutputFromFile('RecepcionXlsxForm').setWidth(480).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Recepción: XLSX → todo');
}
