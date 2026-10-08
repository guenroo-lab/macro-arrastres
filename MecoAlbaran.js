/**
 * MECO — CCM: Albaran (CSV) -> filas en el mismo layout que usa procesarMeco()
 * (Proceso_Meco.gs), e impresión con salto de página por tienda. No toca la
 * hoja TOP real: todo en memoria, para la vista de impresión.
 */

// Cabecera real del Albaran (';' como separador):
// ALMACEN;ID_OPTIMUS;FLETE;FECHA;COD_TIENDA;TIENDA;CIRCUITO;PEDIDO;FLUJO;SECCION;
// REF_LM;DESIG;EAN;CANTIDAD;DOM;PYXIS;CONTENIDO;CONTE_AGRUP;SOP_ALM1;AGRUP_ALM1;SOP_ALM2;TRANSPORTE
const MECO_ALBARAN_COL = {
  ID_OPTIMUS: 1, FLETE: 2, FECHA: 3, TIENDA: 5, PEDIDO: 7,
  REF_LM: 10, DESIG: 11, EAN: 12, CANTIDAD: 13, PYXIS: 15
};

/**
 * Convierte el Albaran de una tienda en filas con el mismo ancho/índices que
 * usa procesarMeco() (21 columnas, 0-based): A=Optimus, C=Flete, F=Tienda,
 * H=Pedido, K=LM, L=Artículo, M=EAN, N=Cantidad, P=Pyxis. El resto vacío.
 */
function _albaranAFilasTOP_(blobAlbaran) {
  const texto = blobAlbaran.getDataAsString();
  const filas = Utilities.parseCsv(texto, ';');
  const N = 21;
  const out = [];
  for (let i = 1; i < filas.length; i++) { // fila 0 = cabecera del Albaran
    const f = filas[i];
    if (!f.some(c => t_(c) !== '')) continue; // línea en blanco (p. ej. sobrantes al final del CSV)
    const fila = new Array(N).fill('');
    fila[0] = f[MECO_ALBARAN_COL.ID_OPTIMUS];
    fila[2] = f[MECO_ALBARAN_COL.FLETE];
    fila[5] = f[MECO_ALBARAN_COL.TIENDA];
    fila[7] = f[MECO_ALBARAN_COL.PEDIDO];
    fila[10] = f[MECO_ALBARAN_COL.REF_LM];
    fila[11] = f[MECO_ALBARAN_COL.DESIG];
    fila[12] = f[MECO_ALBARAN_COL.EAN];
    fila[13] = f[MECO_ALBARAN_COL.CANTIDAD];
    fila[15] = f[MECO_ALBARAN_COL.PYXIS];
    out.push(fila);
  }
  return out;
}

/** Parsea "dd/mm/yyyy" (formato del campo FECHA del Albaran) a Date. */
function _fechaAlbaranADate_(texto) {
  const m = t_(texto).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/**
 * HTML de impresión de CCM: una tienda por página (salto de página antes de
 * cada una, salvo la primera), con el mismo criterio que procesarMeco() sobre
 * TOP: las filas van ORDENADAS por el nº de Pyxis (columna P; el Albarán viene
 * por pedido, no por Pyxis) y el color alterna (CFG.COLORES.VERDE_CLARO/
 * VERDE_OSCURO) cada vez que cambia el Pyxis, no fila a fila.
 * ccmPorTienda: { 'E014': blob, 'E036': blob, ... }.
 * fechaLlegada: Date ya calculada (día siguiente al Albaran, con el salto de
 * fin de semana de siempre) — se muestra igual en las 4 páginas.
 */
function _htmlImpresionCCM_(ccmPorTienda, fechaLlegada) {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const fechaTxt = Utilities.formatDate(fechaLlegada, tz, 'dd/MM/yyyy');
  const ORDEN = ['E014', 'E036', 'E043', 'E279'];

  const estilo = '<style>' +
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box;}' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;margin:0}' +
    '.pagina{padding:18px}' +
    // La carátula está diseñada para vertical (una sola página, texto grande);
    // las tablas van en horizontal (9 columnas). Sin esto, la carátula hereda
    // el horizontal de las tablas, no cabe entera y se desborda a una página
    // 2 casi en blanco (visto en real, 2026-09-09). "page" con nombre le da a
    // SOLO la carátula su propio tamaño de página, sin tocar el de las tablas.
    '.pagina.caratula{page:caratula-meco;}' +
    '@page caratula-meco{size:portrait;margin:12mm;}' +
    'h2{margin:0 0 10px;font-size:16px;color:#333}' +
    'table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #bbb;padding:5px 8px;text-align:left}' +
    'th{background:' + CFG.COLORES.GRIS_TITULO + ';font-weight:bold}' +
    '.p-a{background:' + CFG.COLORES.VERDE_CLARO + '}' +
    '.p-b{background:' + CFG.COLORES.VERDE_OSCURO + '}' +
    '@media print{.salto{page-break-before:always}}' +
    '</style>';

  // Una sola carátula para las 4 tiendas, como primera página. El nº de
  // transporte es el Optimus (col A), igual que en la carátula de Meco normal
  // (ver _datosCaratula_ en Impresion.gs).
  const codsConDatos = ORDEN.filter(cod => ccmPorTienda[cod]);
  let optimus = '';
  if (codsConDatos.length) {
    const primeras = _albaranAFilasTOP_(ccmPorTienda[codsConDatos[0]]);
    if (primeras.length) optimus = primeras[0][0];
  }
  const car = _caratulaFragmento_({ origen: 'Meco', transporte: optimus, fecha: fechaTxt });
  const caratulaHtml = car.error ? '' : '<div class="pagina caratula">' + car.cuerpo + '</div>';
  const caratulaCss = car.error ? '' : car.css;

  const paginas = codsConDatos
    .map((cod, idx) => {
      const filas = _ordenarPorPyxis_(_albaranAFilasTOP_(ccmPorTienda[cod]), 15);
      let pyxisAnt = null, alterna = false;
      const filasHtml = filas.map(f => {
        const pyxis = _clavePyxis_(f[15]);
        if (pyxis !== pyxisAnt) { alterna = !alterna; pyxisAnt = pyxis; }
        const clase = alterna ? 'p-a' : 'p-b';
        return '<tr class="' + clase + '"><td>' + esc_(f[0]) + '</td><td>' + esc_(f[2]) + '</td><td>' + esc_(f[5]) + '</td><td>' +
          esc_(f[7]) + '</td><td>' + esc_(f[10]) + '</td><td>' + esc_(f[11]) + '</td><td>' +
          esc_(f[12]) + '</td><td>' + esc_(f[13]) + '</td><td>' + esc_(f[15]) + '</td></tr>';
      }).join('\n');
      // Salto antes de cada tienda; también antes de la primera, porque la
      // carátula ocupa la página 1.
      const salto = (caratulaHtml || idx > 0) ? ' salto' : '';
      return '<div class="pagina' + salto + '">' +
        '<h2>' + esc_(cod) + ' — llegada ' + fechaTxt + '</h2>' +
        '<table><tr><th>Optimus</th><th>Flete</th><th>Tienda</th><th>Pedido</th><th>LM</th><th>Artículo</th><th>EAN</th><th>Cantidad</th><th>Pyxis</th></tr>' +
        filasHtml + '</table></div>';
    }).join('\n');

  const estiloCompleto = estilo.replace('</style>', caratulaCss + '</style>');
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' + estiloCompleto + '</head><body>' + caratulaHtml + paginas + '</body></html>';
}
