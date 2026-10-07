/**
 * MENÚ, PANEL Y UTILIDADES COMUNES
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 Arrastres')
    .addItem('🎛️  Abrir panel de control', 'abrirPanel')
    .addSeparator()

    .addSubMenu(ui.createMenu('① PROCESAR')
      .addItem('📦  Antequera: PDF → TOP', 'abrirAntequera')
      .addItem('📦  Meco: ZIP → CCM + HODOS', 'abrirMecoZip')
      .addItem('📥  Arrastres: CSV → todo (Valencia/Torija)', 'abrirArrastreCsv')
      .addItem('📥  Recepción: XLSX → todo', 'abrirRecepcionXlsx')
      .addItem('🟢  Arrastres (Valencia · Torija · Antequera)', 'procesarArrastres')
      .addItem('📥  Marcar pedidos a retener (Recepción)', 'procesarRecepcion')
      .addItem('🚛  Meco — aplicar formato', 'procesarMecoMenu'))

    .addSubMenu(ui.createMenu('② RETENIDOS DEL DÍA')
      .addItem('➕  Añadir / quitar (abre el panel)', 'abrirPanel')
      .addItem('🗑️  Vaciar retenidos del día', 'vaciarRetenidosMenu'))

    .addSubMenu(ui.createMenu('③ ENVIAR retenidos por correo')
      .addItem('📧  Enviar a Málaga', 'enviarMalagaMenu')
      .addItem('📧  Enviar a Marbella', 'enviarMarbellaMenu')
      .addItem('📧  Enviar a Mijas', 'enviarMijasMenu'))

    .addSubMenu(ui.createMenu('④ IMPRIMIR  ·  PDF')
      .addItem('🖨️  Imprimir pedidos Pyxis arrastres', 'imprimirPedidosPyxisArrastres')
      .addItem('🖨️  Imprimir pedidos Pyxis recepción', 'imprimirPedidosPyxisRecepcion')
      .addSeparator()
      .addItem('📄  Imprimir hoja TOP (horizontal)', 'imprimirTOP')
      .addItem('🧾  Imprimir solo la carátula (TAISA)', 'abrirCaratula'))

    .addSubMenu(ui.createMenu('⑤ CACHÉS')
      .addItem('🧱  Vaciar caché de cerámica (HODOS)', 'vaciarCacheCeramica')
      .addItem('📇  Vaciar caché de EAN (Arrastres)', 'vaciarCacheEAN'))

    .addSeparator()
    .addSubMenu(ui.createMenu('📊 CELDAS DEL LIBRO')
      .addItem('📊  Ver celdas reservadas por hoja', 'diagnosticoCeldas')
      .addItem('✂️  Recortar hojas a su contenido', 'recortarHojasAlContenido'))

    .addSeparator()
    .addSubMenu(ui.createMenu('⏰ AUTOMATIZACIONES')
      .addItem('▶️  Activar (portada 12:30 · borrado 3:00 · informes)', 'activarAutomatizaciones')
      .addItem('⏹️  Desactivar', 'desactivarAutomatizaciones')
      .addSeparator()
      .addItem('📊  Enviar informe semanal ahora', 'informeSemanal')
      .addItem('📈  Enviar informe mensual ahora', 'informeMensual'))

    .addItem('🩹  Borrar solo TOP', 'borrarTOPMenu')
    .addItem('🧹  Borrar todo el contenido', 'borrarTodoMenu')

    .addSeparator()
    .addItem('💡  Enviar sugerencia o fallo', 'abrirSugerencias')

    .addToUi();
}

/** Abre el panel lateral con botones grandes */
function abrirPanel() {
  const html = HtmlService.createHtmlOutputFromFile('Panel')
    .setTitle('Panel Arrastres')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

/* ====================== UTILIDADES ====================== */

/** Texto limpio */
/** Limpia espacios normales y "invisibles" (NBSP, BOM, zero-width) de los extremos.
 *  Estos suelen venir de copiar/pegar desde Excel y hacen que "467 " != "467". */
function t_(v) {
  return String(v == null ? '' : v).replace(/^[\s\u00A0\u200B\uFEFF]+|[\s\u00A0\u200B\uFEFF]+$/g, '');
}

/** Quitar tildes (Módulo 5) */
function quitarTildes(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Última fila con datos en una columna (End(xlUp)), acotado a getLastRow para ir rápido */
function ultimaFilaCol_(sheet, col) {
  const last = sheet.getLastRow();
  if (last < 1) return 1;
  const vals = sheet.getRange(1, col, last, 1).getValues();
  for (let i = last - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() !== '') return i + 1;
  }
  return 1;
}

/**
 * Localiza las columnas de TOM por el TEXTO de su cabecera (fila 1), NO por
 * posición fija. Así aguanta que la fuente cambie de formato (p.ej. se pega
 * pedidos_totales.csv en vez de Pedidos_Vivos_lineas...csv: mismos campos,
 * pero en otras columnas) sin tocar código, y detecta si falta alguno.
 * Devuelve índices 0-based; `undefined` si no encuentra esa cabecera.
 * Usado por Proceso_Arrastres.gs, Proceso_Recepcion.gs y Hodos.gs.
 */
/**
 * Cabecera normalizada para comparar: sin BOM ni comillas, sin acentos, "º/°" -> "o", minúsculas y solo letras y
 * dígitos. Así "Nº Pedido cliente", "N° pedido cliente" y "NO PEDIDO CLIENTE" son la misma columna.
 */
function _normCabeceraTOM_(s) {
  return String(s == null ? '' : s)
    .replace(/[\uFEFF"']/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00ba\u00b0\u00aa]/g, 'o')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function _indicesTOM_(cabecera) {
  // Nombre EXACTO de siempre -> clave. Se mantiene tal cual (es lo que ha funcionado en producción)...
  const MAPA = {
    'Nº Pedido cliente': 'pyxis',
    'Tiene transporte': 'transporte',
    'Referencia': 'referencia',
    'Desc. Referencia': 'descReferencia',
    'Tipo línea': 'tipoLinea',
    'Cantidad': 'cantidad',
    'Nº pedido proveedor': 'pegase',
    // Opcional (no está en TOM_DRIVE_COLUMNAS_MINIMAS): solo lo usa Antequera
    // para no cruzar LM + unidades con pedidos de otra tienda.
    'Nº Tienda': 'tienda'
  };
  // ...y, si no coincide exacto, la misma columna normalizada (acentos, mayúsculas, "N°"/"No"/"Num"...).
  const NORM = {};
  Object.keys(MAPA).forEach(k => { NORM[_normCabeceraTOM_(k)] = MAPA[k]; });
  ['npedidocliente', 'numpedidocliente', 'numeropedidocliente'].forEach(a => { NORM[a] = 'pyxis'; });
  ['npedidoproveedor', 'numpedidoproveedor', 'numeropedidoproveedor'].forEach(a => { NORM[a] = 'pegase'; });
  ['ntienda', 'numtienda', 'numerotienda'].forEach(a => { NORM[a] = 'tienda'; });
  const idx = {};
  for (let c = 0; c < cabecera.length; c++) {
    const clave = MAPA[t_(cabecera[c])] || NORM[_normCabeceraTOM_(cabecera[c])];
    if (clave && idx[clave] === undefined) idx[clave] = c;
  }
  return idx;
}

/** Ajusta columnas solo si está activado en CFG (operación lenta) */
function autoajustar_(sheet, desde, cantidad) {
  if (CFG.AUTOAJUSTAR_COLUMNAS) sheet.autoResizeColumns(desde, cantidad);
}

/**
 * Normaliza un valor de LM a número ENTERO sin decimales. Convierte enteros,
 * notación científica y "entero con parte decimal" (49009538.0 -> 49009538) a
 * Number; deja intacto lo no numérico (códigos con letras, vacíos). Junto con
 * setNumberFormat('0') garantiza que la columna LM salga siempre numérica.
 */
function _lmNum_(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim();
  if (s === '') return '';
  if (/^\d+$/.test(s)) return Number(s);                          // ya es entero
  if (/[eE]/.test(s)) { const n = Number(s); if (isFinite(n)) return Math.round(n); } // científica
  const m = s.match(/^(\d+)[.,]\d+$/);                            // entero con decimales
  if (m) return Number(m[1]);
  return v;                                                       // no numérico: sin tocar
}

/**
 * Exporta un rango de una hoja a PDF en Drive y devuelve la URL.
 * opciones: { vertical, lineas, filas, cols, repetirFila1 }
 */
function exportarPDF_(sheet, nombreArchivo, opciones) {
  opciones = opciones || {};
  const ss = sheet.getParent();
  SpreadsheetApp.flush();

  const params = {
    format: 'pdf', gid: sheet.getSheetId(), size: 'A4',
    portrait: opciones.vertical ? 'true' : 'false',
    fitw: 'true', sheetnames: 'false', printtitle: 'false',
    pagenumbers: 'false', gridlines: opciones.lineas ? 'true' : 'false',
    fzr: opciones.repetirFila1 ? 'true' : 'false',
    horizontal_alignment: 'CENTER',
    top_margin: '0.4', bottom_margin: '0.4', left_margin: '0.25', right_margin: '0.25'
  };
  if (opciones.filas) { params.r1 = 0; params.r2 = opciones.filas; }
  if (opciones.cols) { params.c1 = 0; params.c2 = opciones.cols; }

  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?' +
    Object.keys(params).map(k => k + '=' + params[k]).join('&');

  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob().setName(nombreArchivo + '.pdf');

  const carpeta = CFG.CARPETA_PDF
    ? DriveApp.getFolderById(CFG.CARPETA_PDF)
    : DriveApp.getRootFolder();

  return carpeta.createFile(blob).getUrl();
}

/** Muestra un cuadro con enlaces a los PDF generados (sirve desde menú y desde panel) */
function mostrarEnlacesPDF_(titulo, enlaces) {
  if (!enlaces || !enlaces.length) {
    SpreadsheetApp.getActive().toast('No se generó ningún PDF.', titulo, 5);
    return;
  }
  const html = '<div style="font-family:Arial;font-size:13px">' +
    enlaces.map(e => '<p><a href="' + e.url + '" target="_blank">📄 ' + e.nombre + '</a></p>').join('') +
    '<p style="color:#888">Abre el PDF y usa Ctrl+P para imprimir.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(440)
      .setHeight(Math.min(120 + enlaces.length * 34, 520)),
    titulo
  );
}

