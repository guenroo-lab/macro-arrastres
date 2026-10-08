/**
 * PROCESO RECEPCIÓN  (Módulo 12 optimizado)
 * Expande las líneas de TOP con transporte = "no" (col AH) según TOM, marca
 * VERDE las que tienen transporte válido, reconstruye TOP, elimina filas "LS",
 * ordena, colorea, y registra los retenidos por tienda en la hoja RETENIDOS.
 *
 * Optimización: una sola escritura de TOP con formato por bloques y los
 * retenidos salen de memoria (sin hojas auxiliares ni escritura fila a fila).
 */
/** Candado de TOP: mismo motivo que en Proceso_Arrastres.gs (ver ese comentario). */
function _procesarRecepcionNucleo_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { error: 'Hay otro proceso en marcha, espera unos segundos.' };
  }
  try {
    return _procesarRecepcionNucleoCalculo_();
  } finally {
    lock.releaseLock();
  }
}

function _procesarRecepcionNucleoCalculo_() {
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const wsEAN = ss.getSheetByName(CFG.HOJAS.EAN);
  const NCOLS = 39; // hasta AM

  const uTOP = wsTOP.getLastRow();
  if (uTOP < 2) return { error: 'La hoja TOP no tiene datos.' };

  // EAN
  const uEAN = wsEAN.getLastRow();
  const ean = wsEAN.getRange(1, 1, uEAN, 5).getValues();
  const limpia = v => { const s = t_(v), p = s.indexOf('.'); return p > -1 ? s.substring(0, p) : s; };
  const dictEAN = {};
  for (let r = 1; r < uEAN; r++) {
    let c = limpia(ean[r][0]); if (c !== '' && !(c in dictEAN)) dictEAN[c] = t_(ean[r][1]);
    c = limpia(ean[r][3]);     if (c !== '' && !(c in dictEAN)) dictEAN[c] = t_(ean[r][4]);
  }

  // TOM ya no es una hoja: se lee directo desde Drive (ver TOMDrive.gs).
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
  const tom = tomDatos.filas;
  const uTOM = tom.length;
  const iTOM = tomDatos.iTOM;
  const dictTOM = {};
  for (let i = 1; i < uTOM; i++) {
    const k = t_(tom[i][iTOM.pegase]);
    if (k !== '') (dictTOM[k] = dictTOM[k] || []).push(i);
  }

  // TOP
  const anchoTOP = Math.max(wsTOP.getLastColumn(), NCOLS);
  const top = wsTOP.getRange(1, 1, uTOP, anchoTOP).getValues();
  const norm = fila => { const f = fila.slice(0, NCOLS); while (f.length < NCOLS) f.push(''); return f; };

  // Expansión
  const dest = [norm(top[0])];
  for (let i = 1; i < uTOP; i++) {
    const colA = t_(top[i][0]);
    const colAH = t_(top[i][33]).toLowerCase(); // AH
    if (colAH === 'no' && (colA in dictTOM)) {
      for (const j of dictTOM[colA]) {
        const lm = limpia(tom[j][iTOM.referencia]); // TOM Referencia
        const valido = t_(tom[j][iTOM.transporte]).toLowerCase() === 'si' || lm === CFG.LM_SIEMPRE_VALIDO;
        const fila = norm(top[i]);
        if (valido) {
          fila[1] = tom[j][iTOM.pyxis];          // B  Pyxis (TOM Nº Pedido cliente)
          fila[36] = lm;                         // AK LM
          fila[24] = tom[j][iTOM.descReferencia]; // Y  Artículo (TOM Desc. Referencia)
          fila[37] = tom[j][iTOM.cantidad];      // AL Unidades (TOM Cantidad)
          fila[38] = 'VERDE';                    // AM Estado
          if (lm in dictEAN) fila[25] = dictEAN[lm]; // Z EAN
        }
        dest.push(fila);
      }
    } else {
      dest.push(norm(top[i]));
    }
  }

  // Quitar filas J = "LS" y ordenar (AM desc, B asc)
  const cabecera = dest[0];
  let datos = dest.slice(1).filter(f => t_(f[9]) !== 'LS');
  datos.sort((a, b) => {
    const ma = String(a[38]), mb = String(b[38]);
    if (ma !== mb) return ma < mb ? 1 : -1;
    const ba = String(a[1]), bb = String(b[1]);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });

  cabecera[1]='Pyxis'; cabecera[24]='Articulo'; cabecera[25]='EAN';
  cabecera[36]='LM'; cabecera[37]='UNIDADES'; cabecera[38]='Estado';
  const final = [cabecera].concat(datos);
  const ultFila = final.length;

  // Backgrounds A:AL (38 col), alternando por Pyxis (B) en las VERDE
  const ANCHO = 38;
  const fondos = [];
  let pedAnt = '', alt = false;
  for (let i = 1; i < ultFila; i++) {
    if (final[i][38] === 'VERDE') {
      const b = String(final[i][1]);
      if (b !== pedAnt) { alt = !alt; pedAnt = b; }
      fondos.push(new Array(ANCHO).fill(alt ? CFG.COLORES.VERDE_CLARO : CFG.COLORES.VERDE_OSCURO));
    } else {
      fondos.push(new Array(ANCHO).fill(CFG.COLORES.BLANCO));
    }
  }

  // Escritura
  for (let r = 1; r < final.length; r++) final[r][36] = _lmNum_(final[r][36]); // LM (col AK) entero
  wsTOP.clearContents();
  wsTOP.getRange(1, 1, ultFila, NCOLS).setValues(final);
  if (ultFila > 1) {
    wsTOP.getRange(2, 1, ultFila - 1, ANCHO).setBackgrounds(fondos);
    wsTOP.getRange(2, 26, ultFila - 1, 1).setNumberFormat('0'); // Z (EAN)
    wsTOP.getRange(2, 37, ultFila - 1, 1).setNumberFormat('0'); // AK (LM): entero sin decimales
    wsTOP.getRange(1, 1, ultFila, ANCHO).setBorder(true, true, true, true, true, true);
  }
  wsTOP.getRange(1, 1, 1, NCOLS).setBackground(CFG.COLORES.GRIS_OSCURO).setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);
  autoajustar_(wsTOP, 1, NCOLS);
  // Muestra TODAS las columnas antes de ocultar las propias: si el proceso
  // anterior (Arrastres, que oculta un juego de columnas distinto) dejó
  // otras ocultas, aquí se quedarían escondidas columnas que Recepción sí
  // necesita ver (visto en real, 2026-09-10).
  wsTOP.showColumns(1, wsTOP.getMaxColumns());
  wsTOP.hideColumns(7, 3);   // G:I
  wsTOP.hideColumns(11, 7);  // K:Q
  wsTOP.hideColumns(18, 7);  // R:X
  wsTOP.hideColumns(27, 10); // AA:AJ
  wsTOP.hideColumns(39);     // AM

  // Alta de retenidos por tienda (acumula en RETENIDOS, sin duplicados)
  const registros = [];
  const dedupRun = {};
  const vistos = { 'Málaga': 0, 'Marbella': 0, 'Mijas': 0, 'Granada': 0 };
  const codigosSinMapa = {};
  for (let i = 1; i < ultFila; i++) {
    if (final[i][38] !== 'VERDE') continue;
    const codNum = parseInt(t_(final[i][2]), 10);              // col C -> entero
    const cod = isNaN(codNum) ? '' : ('000' + codNum).slice(-3); // -> "036" / "014" / "279"
    const tiendaCanon = CFG.TIENDA_RECEPCION[cod];
    if (!tiendaCanon) { codigosSinMapa[cod] = (codigosSinMapa[cod] || 0) + 1; continue; }
    vistos[tiendaCanon] = (vistos[tiendaCanon] || 0) + 1;
    const pedido = t_(final[i][0]); // col A
    const clave = tiendaCanon + '|' + pedido;
    if (clave in dedupRun) continue;
    dedupRun[clave] = true;
    registros.push({
      tienda: tiendaCanon, tipo: 'Recepción', pedido: final[i][0],
      pyxis: final[i][1], agrupacion: '', sscc: ''
    });
  }
  const res = registrarRetenidos_(registros);
  const d = res.detalle;
  const det = ['Málaga', 'Marbella', 'Mijas', 'Granada']
    .map(t => t + ': ' + vistos[t] + ' VERDE → ' + d[t].nuevos + ' nuevos' + (d[t].repetidos ? ' (+' + d[t].repetidos + ' ya estaban)' : ''))
    .join('  |  ');
  const sinMapa = Object.keys(codigosSinMapa).map(c => c + '×' + codigosSinMapa[c]).join(', ');

  const verdes = final.filter(f => f[38] === 'VERDE').length;
  let msg = 'Recepción OK · ' + verdes + ' VERDE · ' + res.total + ' nuevos\n' + det;
  if (sinMapa) msg += '\nCódigos sin tienda: ' + sinMapa;
  // TOM sin actualizar, o sin alguna de las tiendas que hay en este TOP (p. ej. el export manual no trae Granada, 043): se avisa.
  if (typeof _avisoTOMAntiguo_ === 'function') {
    const avTom = _avisoTOMAntiguo_(tomDatos);
    const necesarias = {};
    for (let i = 1; i < uTOP; i++) {
      if (t_(top[i][33]).toLowerCase() !== 'no') continue;          // AH: solo las líneas que necesitan cotejo con TOM
      const n = parseInt(t_(top[i][2]), 10);                          // C: código de tienda
      if (!isNaN(n)) necesarias[String(n)] = true;
    }
    const avTie = _avisoTOMSinTiendas_(tomDatos, Object.keys(necesarias));
    if (avTie) msg = '⚠️ ' + avTie + '\n' + msg;
    if (avTom) msg = '⚠️ ' + avTom + '\n' + msg;
  }
  Logger.log(msg);
  return { mensaje: msg };
}

/** Envoltorio de siempre: calcula con _procesarRecepcionNucleo_ y hace el toast. */
function procesarRecepcion() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarRecepcionNucleo_();
  if (r.error) { ss.toast(r.error, '📥 Recepción', 8); return r.error; }
  ss.toast(r.mensaje, '📥 Recepción', 10);

  const imp = _htmlImpresionRecepcion_();
  if (!imp.error) {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(imp.html).setWidth(1000).setHeight(750),
      '🖨️ Impresión automática'
    );
  }
  return r.mensaje;
}

/**
 * Envoltorio para la web: mismo motivo que procesarArrastresWeb() en
 * Proceso_Arrastres.gs (SpreadsheetApp.getUi() no existe fuera del Sheet).
 */
function procesarRecepcionWeb() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarRecepcionNucleo_();
  if (r.error) return { error: r.error };
  ss.toast(r.mensaje, '📥 Recepción', 10);
  const imp = _htmlImpresionRecepcion_();
  return { mensaje: r.mensaje, htmlImpresion: imp.error ? null : imp.html };
}
