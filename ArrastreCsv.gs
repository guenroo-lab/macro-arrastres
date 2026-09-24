/**
 * ARRASTRES — CSV AUTOMÁTICO (Valencia / Torija)
 * Sustituye el pegado manual: el CSV que manda Leroy Merlin (Q_439ARR.CSV,
 * Q_431ARR.CSV) encaja columna a columna con TOP (A..W, 23 columnas) — ver
 * docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md, sección 4.1.
 *
 * Tres trampas ya comprobadas contra archivos reales:
 *   1. La cabecera del export trae 22 nombres pero las filas traen 23 campos
 *      (falta un título entre EMBALAJE y PRODUCTO) -> se lee por POSICIÓN,
 *      nunca por nombre de cabecera, y se descarta la fila de cabecera entera.
 *   2. El archivo es Windows-1252, no UTF-8 (hay "PELDAÑOS", "16Ø" en Torija).
 *   3. El campo 18 (sin título) es el LM real, no el 19 (PRODUCTO).
 */

const ARRASTRE_CSV_ANCHO_ESPERADO = 23;

/**
 * Decodifica el CSV y lo vuelca en TOP (sin procesar todavía). Devuelve
 * { plataforma, filasDescartadas } o { error } si no reconoce ALM_ORIGEN —
 * en ese caso NO toca TOP. Compartido por la versión de diálogo (Sheet) y la
 * de la web: la única diferencia entre ambas es a qué función de proceso
 * llaman después (procesarArrastres, que abre showModalDialog, o
 * procesarArrastresWeb, que no existe fuera del Sheet).
 */
function _volcarCsvArrastreEnTOP_(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, 'text/csv', nombreArchivo);
  const texto = blob.getDataAsString('Windows-1252');

  let todas;
  try {
    todas = Utilities.parseCsv(texto, ';');
  } catch (e) {
    return { error: 'No se puede leer el archivo como CSV (' + e.message + ').' };
  }
  if (todas.length < 2) return { error: 'El archivo está vacío o solo trae la cabecera.' };

  const datos = todas.slice(1); // la cabecera del export viene incompleta: se descarta entera
  const buenas = [], descartadas = [];
  datos.forEach(f => { (f.length === ARRASTRE_CSV_ANCHO_ESPERADO ? buenas : descartadas).push(f); });
  if (!buenas.length) return { error: 'Ninguna fila tiene las ' + ARRASTRE_CSV_ANCHO_ESPERADO + ' columnas esperadas.' };

  const codigo = t_(buenas[0][0]);
  const plataforma = CFG.ORIGENES[codigo];
  if (!plataforma) return { error: 'Código de plataforma no reconocido: "' + codigo + '" (columna ALM_ORIGEN).' };

  const ANCHO = ARRASTRE_CSV_ANCHO_ESPERADO;
  const cabeceraProvisional = new Array(ANCHO).fill(''); // procesarArrastres la sobrescribe en su paso 6
  const matriz = [cabeceraProvisional].concat(buenas);

  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();

  const rango = wsTOP.getRange(1, 1, matriz.length, ANCHO);
  rango.setNumberFormat('@'); // texto: no perder ceros a la izquierda ni notación científica
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, ANCHO).setFontWeight('bold');

  return { plataforma: plataforma, filasDescartadas: descartadas.length };
}

/**
 * Vuelca el CSV en TOP y llama a procesarArrastres() (que ya calcula, manda a
 * HODOS y abre la impresión). Devuelve { plataforma, filasDescartadas,
 * resumenProceso } o { error }. Uso: diálogo del menú/panel (Sheet abierto).
 */
function procesarCsvArrastre(base64, nombreArchivo) {
  const v = _volcarCsvArrastreEnTOP_(base64, nombreArchivo);
  if (v.error) return v;
  const resumenProceso = procesarArrastres();
  return { plataforma: v.plataforma, filasDescartadas: v.filasDescartadas, resumenProceso: resumenProceso };
}

/**
 * Igual que procesarCsvArrastre(), pero para la web: llama a
 * procesarArrastresWeb() (sin showModalDialog) y devuelve también el HTML de
 * impresión para que el cliente lo abra con window.open + document.write.
 */
function procesarCsvArrastreWeb(base64, nombreArchivo) {
  const v = _volcarCsvArrastreEnTOP_(base64, nombreArchivo);
  if (v.error) return v;
  const r = procesarArrastresWeb();
  if (r.error) return { error: r.error };
  return { plataforma: v.plataforma, filasDescartadas: v.filasDescartadas, resumenProceso: r.mensaje, htmlImpresion: r.htmlImpresion };
}

/** Abre el diálogo de subida del CSV (menú y panel). */
function abrirArrastreCsv() {
  const html = HtmlService.createHtmlOutputFromFile('ArrastreCsvForm').setWidth(480).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Arrastres: CSV → todo');
}
