/**
 * MECO — ZIP AUTOMÁTICO
 * Sustituye el pegado manual: un ZIP trae CCM/ (4 tiendas, se quedan en
 * plataforma) y PLAT MALAGA/ (van a tienda, se dan de alta en HODOS).
 * Ver docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
 */

const MECO_TIENDAS_CODIGO = ['E014', 'E036', 'E043', 'E279']; // CCM: las 4. PLAT MALAGA solo trae E014/E036/E279.

/**
 * De todos los blobs de un ZIP descomprimido, localiza:
 * - ccm: { 'E014': blobAlbaran, 'E036': ..., ... } — el Albaran-*.csv de cada
 *   subcarpeta de tienda dentro de CCM/.
 * - platMalagaXlsx: el único .xlsx que cuelga directo de "PLAT MALAGA/" (no
 *   el de dentro de CCM/, ni ninguno en una subcarpeta de tienda).
 * - faltan: lista de qué se esperaba y no apareció (ej. 'CCM/E043').
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

/**
 * Punto de entrada desde el diálogo (MecoZipForm.html). base64: contenido del
 * .zip en base64 (FileReader del navegador). Descomprime, procesa CCM (impresión
 * por tienda) y PLAT MALAGA->HODOS (lotes por tienda), y devuelve todo junto.
 */
function procesarZipMeco(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blobZip = Utilities.newBlob(bytes, 'application/zip', nombreArchivo);
  const blobs = Utilities.unzip(blobZip);

  const loc = _localizarArchivosMeco_(blobs);
  if (loc.faltan.length) {
    return { faltan: loc.faltan, htmlImpresion: null, hodos: null };
  }

  // Fecha de llegada: FECHA del Albaran de cualquiera de las tiendas (todas
  // traen la misma) + 1 día, salto de fin de semana de siempre.
  const primeraFila = Utilities.parseCsv(loc.ccm['E036'].getDataAsString(), ';')[1];
  const fechaAlbaran = _fechaAlbaranADate_(primeraFila[MECO_ALBARAN_COL.FECHA]);
  const fechaLlegadaTxt = _fechaEnvioPorOrigen_('Meco', fechaAlbaran);
  const partes = fechaLlegadaTxt.split('/');
  const fechaLlegada = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));

  const htmlImpresion = _htmlImpresionCCM_(loc.ccm, fechaLlegada);

  const filasXlsx = _leerXlsxComoValores_(loc.platMalagaXlsx);
  const grupos = _agruparPlatMalagaPorTienda_(filasXlsx);
  const hodos = _enviarLotesMecoAHodos_(grupos);

  return { faltan: [], htmlImpresion: htmlImpresion, hodos: hodos };
}

/** Abre el diálogo de subida del ZIP (menú y panel). */
function abrirMecoZip() {
  const html = HtmlService.createHtmlOutputFromFile('MecoZipForm').setWidth(480).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Procesar ZIP de Meco');
}
