/**
 * MECO — ZIP AUTOMÁTICO
 * Sustituye el pegado manual: un ZIP trae CCM/ (4 tiendas, se quedan en
 * plataforma) y PLAT MALAGA/ (van a tienda, se dan de alta en HODOS).
 * Ver docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
 */

const MECO_TIENDAS_CODIGO = ['E014', 'E036', 'E043', 'E279']; // CCM: las 4. PLAT MALAGA solo trae E014/E036/E279.
const MECO_TIENDA_NOMBRE = { 'E014': 'Marbella', 'E036': 'Málaga', 'E043': 'Granada', 'E279': 'Mijas' };

/**
 * De todos los blobs de un ZIP descomprimido, localiza:
 * - ccm: { 'E014': blobAlbaran, 'E036': ..., ... } — el Albaran-*.csv de cada
 *   subcarpeta de tienda dentro de CCM/.
 * - platMalagaXlsx: el único .xlsx que cuelga directo de "PLAT MALAGA/" (no
 *   el de dentro de CCM/, ni ninguno en una subcarpeta de tienda).
 * - faltan: lista de qué se esperaba y no apareció (ej. 'CCM/E043'). Es solo
 *   informativa: que falte algo NO bloquea, lo decide procesarZipMeco.
 */
function _localizarArchivosMeco_(blobs) {
  const ccm = {};
  let platMalagaXlsx = null;

  blobs.forEach(b => {
    const nombre = b.getName();

    if (nombre.indexOf('/CCM/') !== -1 && /\/Albaran-/.test(nombre)) {
      const carpeta = nombre.split('/CCM/')[1] || '';
      const m = carpeta.match(/E(014|036|043|279)/);
      if (m && !ccm['E' + m[1]]) ccm['E' + m[1]] = b;
      return;
    }

    if (nombre.indexOf('/PLAT MALAGA/') !== -1 && /\.xlsx$/i.test(nombre)) {
      // Directo bajo "PLAT MALAGA/": sin más "/" después de esa carpeta.
      const resto = nombre.split('/PLAT MALAGA/')[1] || '';
      if (resto.indexOf('/') === -1) platMalagaXlsx = b;
    }
  });

  const faltan = [];
  MECO_TIENDAS_CODIGO.forEach(cod => { if (!ccm[cod]) faltan.push('CCM/' + cod); });
  if (!platMalagaXlsx) faltan.push('PLAT MALAGA/xlsx');

  return { ccm: ccm, platMalagaXlsx: platMalagaXlsx, faltan: faltan };
}

/** "E279 (Mijas)": el código con el nombre de la tienda, para los avisos. */
function _tiendaMecoTxt_(cod) {
  return MECO_TIENDA_NOMBRE[cod] ? cod + ' (' + MECO_TIENDA_NOMBRE[cod] + ')' : cod;
}

/**
 * Primera línea de datos de un Albaran (la fila 0 es la cabecera; se saltan las
 * filas en blanco). null si el Albaran no trae ninguna.
 */
function _primeraFilaAlbaran_(blobAlbaran) {
  const filas = Utilities.parseCsv(blobAlbaran.getDataAsString(), ';');
  for (let i = 1; i < filas.length; i++) {
    if (filas[i].some(c => t_(c) !== '')) return filas[i];
  }
  return null;
}

/**
 * Qué tiendas de CCM se pueden imprimir. Que el ZIP no traiga una tienda (sin
 * carpeta, o con su Albaran vacío) significa que ese día no mandaron nada de
 * ella: no se hace esa tienda y se sigue con las demás, nunca bloquea.
 * Devuelve { ccm: { cod: blob } solo de las tiendas con líneas, avisos: [texto] }.
 */
function _tiendasCcmConLineas_(ccm) {
  const conLineas = {}, avisos = [];
  MECO_TIENDAS_CODIGO.forEach(cod => {
    if (!ccm[cod]) avisos.push(_tiendaMecoTxt_(cod) + ': el ZIP no trae archivos de esta tienda — no se imprime.');
    else if (!_primeraFilaAlbaran_(ccm[cod])) avisos.push(_tiendaMecoTxt_(cod) + ': su Albarán viene sin líneas — no se imprime.');
    else conLineas[cod] = ccm[cod];
  });
  return { ccm: conLineas, avisos: avisos };
}

/**
 * Punto de entrada desde el diálogo (MecoZipForm.html) y el Panel (Web.html).
 * base64: contenido del .zip en base64 (FileReader del navegador). Descomprime,
 * procesa CCM (impresión por tienda) y PLAT MALAGA->HODOS (lotes por tienda), y
 * devuelve todo junto:
 *   { faltan, avisos, htmlImpresion, hodos, tiendasCcm }
 * Se hace todo lo que el ZIP trae y se omite lo que no trae (una tienda sin
 * archivos, sin Excel de PLAT MALAGA...): eso va en `avisos` (informativo,
 * htmlImpresion/hodos = null si esa parte no se hizo). Solo `faltan` (no vacío)
 * rechaza el ZIP, y es únicamente cuando no trae NADA que procesar.
 */
function procesarZipMeco(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blobZip = Utilities.newBlob(bytes, 'application/zip', nombreArchivo);
  const blobs = Utilities.unzip(blobZip);

  const loc = _localizarArchivosMeco_(blobs);
  const sel = _tiendasCcmConLineas_(loc.ccm);
  const codsCcm = MECO_TIENDAS_CODIGO.filter(cod => sel.ccm[cod]);
  const avisos = sel.avisos.slice();

  let htmlImpresion = null;
  if (codsCcm.length) {
    // Fecha de llegada: FECHA del Albaran de cualquiera de las tiendas (todas
    // traen la misma) + 1 día, salto de fin de semana de siempre. Se lee de
    // E036 si está (como siempre) y, si no, de la primera tienda que haya.
    const codFecha = sel.ccm['E036'] ? 'E036' : codsCcm[0];
    const primeraFila = _primeraFilaAlbaran_(sel.ccm[codFecha]);
    const fechaAlbaran = _fechaAlbaranADate_(primeraFila[MECO_ALBARAN_COL.FECHA]);
    const fechaLlegadaTxt = _fechaEnvioPorOrigen_('Meco', fechaAlbaran);
    const partes = fechaLlegadaTxt.split('/');
    const fechaLlegada = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));

    htmlImpresion = _htmlImpresionCCM_(sel.ccm, fechaLlegada);
  }

  let hodos = null;
  if (!loc.platMalagaXlsx) {
    avisos.push('PLAT MALAGA: el ZIP no trae su Excel — no se crean etiquetas HODOS.');
  } else {
    const filasXlsx = _leerXlsxComoValores_(loc.platMalagaXlsx);
    const grupos = _agruparPlatMalagaPorTienda_(filasXlsx);
    if (grupos.length) hodos = _enviarLotesMecoAHodos_(grupos);
    else avisos.push('PLAT MALAGA: el Excel no trae pedidos de ninguna tienda — no se crean etiquetas HODOS.');
  }

  // Único rechazo: el ZIP no trae NADA que procesar (ni una tienda de CCM con
  // líneas ni un Excel con pedidos). Cualquier otro hueco solo se avisa.
  if (!htmlImpresion && !hodos) {
    return { faltan: ['CCM/ (ningún Albarán con líneas)', 'PLAT MALAGA/ (Excel con pedidos)'], avisos: [], htmlImpresion: null, hodos: null, tiendasCcm: [] };
  }

  return { faltan: [], avisos: avisos, htmlImpresion: htmlImpresion, hodos: hodos, tiendasCcm: codsCcm.map(_tiendaMecoTxt_) };
}

/** Abre el diálogo de subida del ZIP (menú y panel). */
function abrirMecoZip() {
  const html = HtmlService.createHtmlOutputFromFile('MecoZipForm').setWidth(480).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Procesar ZIP de Meco');
}
