/**
 * IMPRESIÓN DIRECTA (sin PDF)
 * Cada función devuelve { html, n } o { error }. El panel abre una ventana con
 * ese HTML y lanza la impresión del navegador automáticamente.
 */

/** Envuelve un cuerpo HTML en un documento listo para imprimir. */
function _docHTML_(titulo, cuerpo, landscape) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + titulo + '</title>' +
    '<style>' +
    '@page{size:' + (landscape ? 'landscape' : 'portrait') + ';margin:4mm;}' +
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box;}' +
    // CORRECCIÓN PYXIS: Se añade padding-top y padding-left para desplazar abajo y a la derecha
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;margin:0;padding-top:10px;padding-left:15px;}' +
    'h1{font-size:14px;margin:0 0 6px;}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:8px;table-layout:auto;}' +
    'th,td{border:1px solid #555;padding:4px 5px;text-align:left;white-space:normal;word-break:break-word;}' +
    'thead th{background:#e30613;color:#fff;font-size:10px;}' +
    '.info th{background:#333;color:#fff;}' +
    '.pb{page-break-after:always;}' +
    '</style></head><body onload="window.focus();window.print();">' +
    cuerpo +
    '</body></html>';
}

/**
 * Antequera imprime la hoja TOP hasta la W (Trae · Pide); el resto de orígenes, hasta la V como siempre.
 * La X (Dif) NO se imprime (decisión de Pedro, 2026-10-05): sigue en la hoja, oculta, porque Hodos.gs la lee
 * para crear la etiqueta de sobrante. Lo usan TODAS las impresiones de la hoja TOP (htmlImprimirTOP y la
 * automática de procesarArrastres).
 */
function _limiteImpresionTOP_() {
  const o = _datosCaratula_() || {};
  return t_(o.origen) === 'Antequera' ? 23 : 22;
}

/** Antequera: marca como ocultas (1-based) las columnas que están vacías en todas las líneas. */
function _ocultarColumnasVacias_(vals, ocultas, lastCol) {
  for (let c = 0; c < lastCol; c++) {
    let vacia = true;
    for (let r = 1; r < vals.length; r++) { if (t_(vals[r][c]) !== '') { vacia = false; break; } }
    if (vacia) ocultas[c + 1] = true;
  }
}

/* ---------- Hoja TOP (horizontal, hasta col V, márgenes mínimos) ---------- */
function htmlImprimirTOP() {
  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(CFG.HOJAS.TOP);
  // Nº de filas por getLastRow(), NO por la columna A: en la disposición de Meco
  // la columna A viene vacía (la primera cabecera real es ALMACEN, en B), y
  // ultimaFilaCol_(ws,1) devolvía 1 -> se imprimía SOLO la cabecera.
  const u = ws ? ws.getLastRow() : 0;
  if (u < 1) return { error: 'La hoja TOP no tiene datos.' };

  const infoOrigen = _datosCaratula_() || {};
  const LIMITE = _limiteImpresionTOP_();
  const lastCol = Math.min(ws.getLastColumn(), LIMITE);
  const rng = ws.getRange(1, 1, u, lastCol);
  const vals = rng.getDisplayValues();
  const bgs = rng.getBackgrounds();

  const ocultas = [];
  for (let c = 1; c <= lastCol; c++) ocultas[c] = ws.isColumnHiddenByUser(c);
  // Antequera: tampoco se imprime ninguna columna que esté vacía en todas las líneas (más sitio para Trae · Pide).
  if (LIMITE === 23) _ocultarColumnasVacias_(vals, ocultas, lastCol);

  // Cabecera del documento. Se reutiliza la detección de la carátula, que sabe
  // distinguir la disposición de Meco (origen en el bloque info, transporte en
  // el Flete) de la de arrastres (origen en A, Exp en B).
  const info = infoOrigen;
  const origen = t_(info.origen);
  const exp = t_(info.transporte);
  const fRecep = origen ? _fechaEnvioPorOrigen_(origen)
    : Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');

  let head = '', body = '';
  for (let r = 0; r < vals.length; r++) {
    let celdas = '';
    for (let c = 0; c < lastCol; c++) {
      if (ocultas[c + 1]) continue;
      if (r === 0) {
        celdas += '<th>' + esc_(vals[r][c]) + '</th>';
      } else {
        const bg = bgs[r][c];
        const st = (bg && bg.toLowerCase() !== '#ffffff') ? ' style="background:' + bg + '"' : '';
        celdas += '<td' + st + '>' + esc_(vals[r][c]) + '</td>';
      }
    }
    if (r === 0) head = '<tr>' + celdas + '</tr>'; else body += '<tr>' + celdas + '</tr>';
  }

  const titulo = (origen || 'TOP') + (exp ? ' · Exp ' + exp : '') + ' · Recepción ' + fRecep;
  const cuerpo =
    '<div class="tit">' + esc_(origen || 'TOP') +
      (exp ? ' &nbsp;·&nbsp; Exp ' + esc_(exp) : '') +
      ' &nbsp;·&nbsp; Recepción ' + fRecep + '</div>' +
    '<table id="tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';

  // Margen "normal" del folio (10mm) en vez del 3mm ajustadísimo de antes.
  const MARGEN_MM = 10;
  const css =
    '@page{size:landscape;margin:' + MARGEN_MM + 'mm;}' +
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box;}' +
    'html{margin:0;padding:0;}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;}' +
    '#wrap{margin:0;padding:0;width:max-content;}' +
    '.tit{font-size:13px;font-weight:bold;margin:0 0 4px;}' +
    'table{border-collapse:collapse;table-layout:auto;width:max-content !important;}' +
    'th,td{border:1px solid #555;padding:2px 4px;font-size:9px;text-align:left;white-space:nowrap;}' +
    'thead th{background:#333;color:#fff;}';

  // Ancho disponible REAL del folio (A4 apaisado = 297mm menos los márgenes de
  // cada lado, a 96px/pulgada), en vez del número fijo "a ojo" de antes que no
  // se correspondía con el ancho real y cortaba contenido por la derecha.
  const script =
    'window.onload=function(){' +
    'var t=document.getElementById("tbl");' +
    'var wrap=document.getElementById("wrap");' +
    'var mmToPx=96/25.4;' +
    'var avail=Math.floor((297-2*' + MARGEN_MM + ')*mmToPx)-4;' + // -4px de holgura de seguridad
    'var w=t.offsetWidth;' +
    'if(w>avail){' +
    'var sc=avail/w;' +
    'wrap.style.transform="scale("+sc+")";' +
    'wrap.style.transformOrigin="0 0";' +
    'document.body.style.width=Math.ceil(w*sc)+"px";' +
    '}else{' +
    'document.body.style.width=w+"px";' +
    '}' +
    // Sin altura forzada ni overflow:hidden: si la tabla es muy larga, se
    // reparte en más páginas (apaisadas) en vez de recortar filas.
    'window.focus();setTimeout(function(){window.print();},300);' +
    '};';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc_(titulo) +
    '</title><style>' + css + '</style></head><body>' +
    '<div id="wrap">' + cuerpo + '</div>' +
    '<scr' + 'ipt>' + script + '</scr' + 'ipt>' +
    '</body></html>';
  return { html: html, n: u - 1 };
}

/* ---------- Pedidos Pyxis arrastres (Módulo 10) ---------- */
function htmlImprimirPyxisArrastres() {
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const u = ultimaFilaCol_(wsTOP, 11); // K
  if (u < 2) return { error: 'La hoja TOP no tiene datos.' };
  const top = wsTOP.getRange(1, 1, u, 26).getDisplayValues();
  const cA = 0, cF = 5, cG = 6, cI = 8, cK = 10, cP = 15, cS = 18, cT = 19, cU = 20, cV = 21, cW = 22, cZ = 25;

  const pedidos = [], visto = {};
  for (let i = 1; i < u; i++) {
    if (t_(top[i][cZ]) === 'VERDE' && t_(top[i][cK]) !== '' && !visto[String(top[i][cK])]) {
      visto[String(top[i][cK])] = 1; pedidos.push(top[i][cK]);
    }
  }
  if (!pedidos.length) return { error: 'No hay pedidos verdes en la columna K.' };

  let cuerpo = '';
  pedidos.forEach((pedido, idx) => {
    let tienda = '';
    for (let i = 1; i < u; i++) {
      if (String(top[i][cK]) === String(pedido) && t_(top[i][cZ]) === 'VERDE') { tienda = (t_(top[i][cA]) === 'Antequera' && top[i][cF]) ? top[i][cF] : top[i][cG]; break; }
    }
    // Antequera (2026-10-05): el control lleva además PALÉ (soporte, para localizarlo al descargar) y
    // PROVEEDOR (493 = stock propio; en tránsito, el del Detalle), y las unidades de un mismo LM del
    // pedido se SUMAN (el Resumen trae una línea por cada vez que aparece). Los demás orígenes salen
    // exactamente como siempre (solo la primera fila de cada LM).
    let esAnt = false;
    for (let i = 1; i < u; i++) {
      if (String(top[i][cK]) === String(pedido) && t_(top[i][cZ]) === 'VERDE') { esAnt = t_(top[i][cA]) === 'Antequera'; break; }
    }
    const grupos = [], dictS = {};
    for (let i = 1; i < u; i++) {
      if (String(top[i][cK]) === String(pedido) && t_(top[i][cZ]) === 'VERDE') {
        const s = String(top[i][cS]);
        if (!dictS[s]) {
          dictS[s] = grupos.length + 1;
          grupos.push({ i: i, uds: parseFloat(String(top[i][esAnt ? cV : cW]).replace(',', '.')), sops: [t_(top[i][cP])], provs: [t_(top[i][cI])] });
        } else if (esAnt) {
          const g = grupos[dictS[s] - 1], n = parseFloat(String(top[i][cV]).replace(',', '.'));
          if (!isNaN(n)) g.uds = (isNaN(g.uds) ? 0 : g.uds) + n;
          if (g.sops.indexOf(t_(top[i][cP])) === -1) g.sops.push(t_(top[i][cP]));
          if (t_(top[i][cI]) !== '' && g.provs.indexOf(t_(top[i][cI])) === -1) g.provs.push(t_(top[i][cI]));
        }
      }
    }
    let filas = '';
    grupos.forEach(g => {
      const i = g.i;
      if (!esAnt) {
        filas += '<tr><td>' + esc_(top[i][cG]) + '</td><td>' + esc_(top[i][cS]) + '</td><td>' +
          esc_(top[i][cT]) + '</td><td>' + esc_(pedido) + '</td><td>' + esc_(top[i][cU]) +
          '</td><td>' + esc_(top[i][cW]) + '</td><td></td></tr>';
      } else {
        const trae = isNaN(g.uds) ? top[i][cV] : String(Math.round(g.uds * 100) / 100);
        filas += '<tr><td>' + esc_(top[i][cF] || top[i][cG]) + '</td><td>' + esc_(g.sops.filter(x => x !== '').join(' / ')) + '</td><td>' +
          esc_(g.provs.filter(x => x !== '').join(' / ')) + '</td><td>' + esc_(top[i][cS]) + '</td><td>' +
          esc_(top[i][cT]) + '</td><td>' + esc_(pedido) + '</td><td>' + esc_(top[i][cU]) +
          '</td><td>' + esc_(trae) + '</td><td>' + esc_(top[i][cW]) + '</td><td></td></tr>';
      }
    });
    const cabTabla = esAnt
      ? '<th>TIENDA</th><th>PALÉ</th><th>PROVEEDOR</th><th>LM</th><th>EAN</th><th>PEDIDO</th><th>ARTÍCULO</th><th>Trae</th><th>Pide</th><th>Check</th>'
      : '<th>TIENDA</th><th>LM</th><th>EAN</th><th>PEDIDO</th><th>ARTÍCULO</th><th>Unidades</th><th>Check</th>';
    cuerpo += '<div' + (idx < pedidos.length - 1 ? ' class="pb"' : '') + '>' +
      '<h1>Control de pedido · Arrastres</h1>' +
      '<table class="info"><tr><th>Pedido</th><td>' + esc_(pedido) + '</td><th>Tienda</th><td>' + esc_(tienda) + '</td></tr></table>' +
      '<table><thead><tr>' + cabTabla + '</tr></thead><tbody>' +
      filas + '</tbody></table></div>';
  });
  return { html: _docHTML_('Pyxis arrastres', cuerpo, true), n: pedidos.length };
}

/* ---------- Pedidos Pyxis recepción (Módulo 11) ---------- */
function htmlImprimirPyxisRecepcion() {
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const u = ultimaFilaCol_(wsTOP, 2); // B
  if (u < 2) return { error: 'La hoja TOP no tiene datos.' };
  const top = wsTOP.getRange(1, 1, u, 39).getDisplayValues();
  const cA = 0, cB = 1, cC = 2, cE = 4, cY = 24, cZ = 25, cAK = 36, cAL = 37, cAM = 38;
  const nom = c => ({ '036': '36 - Malaga', '014': '014 - Marbella', '279': '279 - Mijas' })[c] || c;

  const pedidos = [], visto = {};
  for (let i = 1; i < u; i++) {
    if (t_(top[i][cAM]) === 'VERDE' && t_(top[i][cB]) !== '' && !visto[String(top[i][cB])]) {
      visto[String(top[i][cB])] = 1; pedidos.push(top[i][cB]);
    }
  }
  if (!pedidos.length) return { error: 'No hay pedidos VERDE en recepción.' };

  let cuerpo = '';
  pedidos.forEach((pedido, idx) => {
    let tienda = '';
    for (let i = 1; i < u; i++) {
      if (String(top[i][cB]) === String(pedido) && t_(top[i][cAM]) === 'VERDE') { tienda = nom(t_(top[i][cC])); break; }
    }
    let filas = '';
    for (let i = 1; i < u; i++) {
      if (String(top[i][cB]) === String(pedido) && t_(top[i][cAM]) === 'VERDE') {
        filas += '<tr><td>' + esc_(nom(t_(top[i][cC]))) + '</td><td>' + esc_(top[i][cA]) + '</td><td>' +
          esc_(top[i][cB]) + '</td><td>' + esc_(top[i][cE]) + '</td><td>' + esc_(top[i][cY]) + '</td><td>' +
          esc_(top[i][cZ]) + '</td><td>' + esc_(top[i][cAK]) + '</td><td>' + esc_(top[i][cAL]) + '</td><td></td></tr>';
      }
    }
    cuerpo += '<div' + (idx < pedidos.length - 1 ? ' class="pb"' : '') + '>' +
      '<h1>Control de pedido · Recepción</h1>' +
      '<table class="info"><tr><th>Pedido</th><td>' + esc_(pedido) + '</td><th>Tienda</th><td>' + esc_(tienda) + '</td></tr></table>' +
      '<table><thead><tr><th>TIENDA</th><th>PEDIDO</th><th>PYXIS</th><th>PROVEEDOR</th><th>ARTÍCULO</th><th>EAN</th><th>LM</th><th>UNIDADES</th><th>CHECK</th></tr></thead><tbody>' +
      filas + '</tbody></table></div>';
  });
  return { html: _docHTML_('Pyxis recepción', cuerpo, true), n: pedidos.length };
}

/* ==========================================================================
 * CARÁTULA DE DESCARGA (para adjuntar a la impresión del TOP)
 * ORIGEN y Nº TRANSPORTE salen de la hoja TOP (A2 y B2). La FECHA se calcula
 * sola por origen (misma regla que los retenidos: _fechaEnvioPorOrigen_,
 * Valencia/Torija/Meco -> mañana, Antequera -> hoy, con salto de fin de
 * semana al lunes). La HORA de la cita no está en ningún sitio del sistema:
 * se pide en un mini formulario justo antes de imprimir.
 * ========================================================================== */

/**
 * Datos de la carátula. La hoja TOP tiene DOS disposiciones distintas:
 *
 *   - Arrastres (Valencia/Torija/Antequera): A = Origen, B = Exp (nº transporte).
 *   - Meco: otra disposición; el nº que se muestra es el de **Optimus** (col A,
 *     sin tocar) y el origen queda en el bloque de información V1:V4 (V2 = 'Meco').
 *
 * Además NO se puede mirar solo la fila 2: procesarMeco ORDENA las filas, así
 * que la fila 2 cambia en cada pasada y puede caer una sin origen (por eso la
 * carátula fallaba con "La hoja TOP no tiene datos"). Se escanea hasta dar con
 * la primera fila que lo traiga.
 */
function _datosCaratula_() {
  const ws = SpreadsheetApp.getActive().getSheetByName(CFG.HOJAS.TOP);
  if (!ws) return null;
  const last = ws.getLastRow();
  if (last < 2) return null;

  const filas = Math.min(last - 1, 200);            // basta con las primeras filas
  const datos = ws.getRange(2, 1, filas, 3).getDisplayValues();   // A..C

  // ¿Disposición Meco? El bloque de información lo dice (V2 = 'Meco').
  let infoV = '';
  try { infoV = t_(ws.getRange(2, 22).getDisplayValue()); } catch (e) { infoV = ''; }
  const esMeco = infoV.toUpperCase() === 'MECO';

  let origen = '', transporte = '';
  if (esMeco) {
    origen = 'Meco';
    for (let i = 0; i < datos.length; i++) {        // Optimus = col A
      const a = t_(datos[i][0]);
      if (a) { transporte = a; break; }
    }
  } else {
    for (let i = 0; i < datos.length; i++) {        // Origen = col A, Exp = col B
      const a = t_(datos[i][0]);
      if (a) { origen = a; transporte = t_(datos[i][1]); break; }
    }
    // Por si el origen viene aún como código sin traducir (p. ej. "448").
    if (CFG.ORIGENES[origen]) origen = CFG.ORIGENES[origen];
  }

  if (!origen) return null;
  return { origen: origen, transporte: transporte, fecha: _fechaEnvioPorOrigen_(origen) };
}

/**
 * Carátulas a imprimir: UNA POR EXPEDICIÓN en Antequera (Pedro, 2026-10-05: puede traer 1, 2 o 3 tiendas a la vez y
 * cada una tiene su expedición); en el resto de orígenes, la de siempre (una sola). Cada elemento es
 * { origen, transporte, fecha, tienda? } (`tienda` solo en Antequera: "036 Málaga"). Orden: Málaga, Marbella, Mijas
 * y, dentro de cada tienda, por nº de expedición.
 */
function _datosCaratulas_() {
  const primera = _datosCaratula_();
  if (!primera) return [];
  if (t_(primera.origen) !== 'Antequera') return [primera];

  const ws = SpreadsheetApp.getActive().getSheetByName(CFG.HOJAS.TOP);
  const last = ws.getLastRow();
  const filas = ws.getRange(2, 1, Math.max(last - 1, 1), 7).getDisplayValues();   // A..G: origen, exp, ..., F tienda, G nombre
  const orden = { 'MALAGA': 1, 'MARBELLA': 2, 'MIJAS': 3 };
  const vistos = {}, lista = [];
  filas.forEach(f => {
    if (t_(f[0]) !== 'Antequera') return;
    const exp = t_(f[1]), tienda = t_(f[5]) || t_(f[6]);
    const k = exp + '|' + tienda;
    if (vistos[k]) return;
    vistos[k] = true;
    const nombre = t_(f[6]).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    lista.push({ origen: 'Antequera', transporte: exp, fecha: primera.fecha, tienda: tienda, _o: orden[nombre] || 9 });
  });
  lista.sort((a, b) => (a._o - b._o) || String(a.transporte).localeCompare(String(b.transporte), 'es', { numeric: true }));
  lista.forEach(x => { delete x._o; });
  return lista.length ? lista : [primera];
}

/**
 * Todas las carátulas juntas, cada una en su página (vertical, una por expedición).
 * Devuelve { css, cuerpo, n } o { error }. `clasePagina`: clase de cada bloque (la impresión de arrastres usa
 * "pagina caratula"; la carátula suelta, ninguna).
 */
function _caratulasFragmento_(clasePagina) {
  const lista = _datosCaratulas_();
  if (!lista.length) return { error: 'La hoja TOP no tiene datos.' };
  let css = '', cuerpo = '';
  for (let i = 0; i < lista.length; i++) {
    const f = _caratulaFragmento_(lista[i]);
    if (f.error) return f;
    css = f.css;
    // Con una sola carátula el HTML es el de siempre (sin envoltorio extra); las siguientes empiezan en página nueva.
    const clase = clasePagina ? (clasePagina + (i > 0 ? ' salto' : '')) : (i > 0 ? 'salto' : '');
    cuerpo += clase ? '<div class="' + clase + '">' + f.cuerpo + '</div>' : f.cuerpo;
  }
  return { css: css, cuerpo: cuerpo, n: lista.length };
}

/**
 * Fragmento reutilizable de la carátula (clases con prefijo car- para no chocar con el TOP).
 * `datos` opcional: { origen, transporte, fecha }. Si no se pasa, se sacan de la
 * hoja TOP (uso de siempre). El ZIP de Meco los pasa a mano porque no toca TOP.
 */
function _caratulaFragmento_(datos) {
  const d = datos || _datosCaratula_();
  if (!d) return { error: 'La hoja TOP no tiene datos.' };

  const css =
    '.car-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14mm;}' +
    '.car-marca{font-size:11px;color:#555;}' +
    '.car-logo{height:20mm;}' +
    '.car-tit{background:#e30613;color:#fff;padding:7mm 9mm;border-radius:2px;margin-bottom:10mm;}' +
    '.car-tit h1{margin:0;font-size:26px;letter-spacing:.03em;text-transform:uppercase;}' +
    (d.tienda ? '.car-tienda{margin-top:2mm;font-size:17px;font-weight:bold;letter-spacing:.04em;}' : '') +
    '.car-campo{border:2.5px solid #111;background:#f4f4f4;padding:7mm 9mm;margin-bottom:8mm;}' +
    '.car-campo .et{font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#555;}' +
    '.car-campo .va{font-size:36px;font-weight:bold;margin-top:2mm;}' +
    '.car-campo .va.vacio{min-height:14mm;border-bottom:1.5px dashed #999;background:#fff;}' +
    '.car-pie{margin-top:16mm;padding-top:6mm;border-top:1px solid #ccc;' +
      'display:flex;justify-content:space-between;font-size:10px;color:#666;}';

  const cuerpo =
    '<div class="car-page">' +
    '<div class="car-top">' +
      '<div class="car-marca"><span>Macro Arrastres · Plataforma Málaga</span></div>' +
      '<img class="car-logo" src="data:image/png;base64,' + CFG.LOGO_TAISA_B64 + '">' +
    '</div>' +
    '<div class="car-tit"><h1>Plantilla de descarga</h1>' +
      (d.tienda ? '<div class="car-tienda">Tienda: ' + esc_(d.tienda) + '</div>' : '') + '</div>' +
    '<div class="car-campo"><div class="et">Origen</div><div class="va">' + esc_(d.origen) + '</div></div>' +
    '<div class="car-campo"><div class="et">Nº transporte</div><div class="va">' + esc_(d.transporte || '—') + '</div></div>' +
    '<div class="car-campo"><div class="et">Fecha de cita</div><div class="va">' + esc_(d.fecha) + '</div></div>' +
    '<div class="car-campo"><div class="et">Muelle</div><div class="va vacio">&nbsp;</div></div>' +
    '<div class="car-pie"><span>Taisa Logistics</span><span>Generado automáticamente</span></div>' +
    '</div>';

  return { cuerpo: cuerpo, css: css };
}

/** Imprime solo la carátula (sin el TOP). Se mantiene por si hace falta suelta. */
function htmlImprimirCaratula() {
  const f = _caratulasFragmento_();   // una por expedición en Antequera; una sola en el resto
  if (f.error) return f;
  const css =
    '@page{size:portrait;margin:12mm;}' +
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;}' +
    (f.n > 1 ? '.salto{page-break-before:always;}' : '') +
    f.css;
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Carátula de descarga</title>' +
    '<style>' + css + '</style></head><body onload="window.focus();window.print();">' +
    f.cuerpo + '</body></html>';
  return { html: html, n: f.n };
}

/* ==========================================================================
 * LANZADORES DE IMPRESIÓN (menú y botones del panel)
 * Las funciones html* devuelven { html, n } o { error }, pero una función
 * llamada desde el menú no puede abrir por sí sola la ventana de impresión.
 * Estos lanzadores abren un diálogo mínimo que pide el HTML al servidor y lo
 * vuelca en una ventana nueva que se imprime sola (mismo mecanismo del panel).
 * ========================================================================== */

/** Abre el diálogo que recupera el HTML de la función `fnHtml` y lo imprime (sin pedir datos). */
function _abrirImpresion_(fnHtml, titulo) {
  const js =
    'var m=document.getElementById("m");' +
    // La ventana se abre YA, al cargar este diálogo (mismo gesto que el clic del menú): si se
    // abre después de que vuelva la respuesta del servidor, el navegador ya no lo cuenta como
    // gesto del usuario y la bloquea en silencio (se queda "Preparando impresión…" para siempre).
    'var w=window.open("","_blank");' +
    'if(!w){m.style.color="#c00";m.textContent="Permite las ventanas emergentes para imprimir.";}' +
    'else{' +
      'google.script.run' +
      '.withSuccessHandler(function(r){' +
        'if(!r||r.error){w.close();m.style.color="#c00";m.textContent=(r&&r.error)||"Nada que imprimir.";return;}' +
        'w.document.open();w.document.write(r.html);w.document.close();' +
        'm.style.color="#0a0";m.textContent="Enviado a impresión ("+(r.n||0)+"). Puedes cerrar esta ventana.";' +
      '})' +
      '.withFailureHandler(function(e){w.close();m.style.color="#c00";m.textContent=e.message;})' +
      '["' + fnHtml + '"]();' +
    '}';

  const html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;margin:16px}</style>' +
    '</head><body><div id="m">Preparando impresión…</div>' +
    '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>'
  ).setWidth(360).setHeight(130);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}

function imprimirTOP()                   { _abrirImpresion_('htmlImprimirTOP', '🖨️ Imprimir hoja TOP'); }
function abrirCaratula()                 { _abrirImpresion_('htmlImprimirCaratula', '🖨️ Imprimir carátula'); }
function imprimirPedidosPyxisArrastres() { _abrirImpresion_('htmlImprimirPyxisArrastres', '🖨️ Imprimir Pyxis arrastres'); }
function imprimirPedidosPyxisRecepcion() { _abrirImpresion_('htmlImprimirPyxisRecepcion', '🖨️ Imprimir Pyxis recepción'); }

/**
 * HTML de impresión automática para arrastres: carátula + hoja TOP en un solo
 * documento, con salto de página entre ambas. Se abre sola al terminar
 * procesarArrastres() (decisión del usuario, mismo comportamiento que Meco).
 * Construye la tabla de TOP con su propio HTML (sin extraer el script de
 * autoajuste de htmlImprimirTOP, que se deja intacto para su uso independiente
 * desde el menú/panel), pero SÍ reutiliza la misma técnica de ajuste de ancho
 * (probada en producción) para que la tabla no se corte por la derecha, y la
 * misma cabecera de impresión de colores que ya usan _docHTML_/htmlImprimirTOP
 * (sin ella, Chrome imprime sin fondos por defecto y la cabecera de la tabla
 * sale sin pintar — visto en real, 2026-09-08).
 */
function _htmlImpresionArrastres_() {
  // Una carátula por expedición en Antequera (1, 2 o 3 tiendas); en el resto de orígenes, la de siempre.
  const car = _caratulasFragmento_('pagina caratula');
  if (car.error) return { error: car.error };

  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(CFG.HOJAS.TOP);
  const u = ws ? ws.getLastRow() : 0;
  if (u < 1) return { error: 'La hoja TOP no tiene datos.' };

  const LIMITE = _limiteImpresionTOP_(); // igual que htmlImprimirTOP: hasta la V (Antequera: hasta la W, con Trae · Pide)
  const lastCol = Math.min(ws.getLastColumn(), LIMITE);
  const rng = ws.getRange(1, 1, u, lastCol);
  const vals = rng.getDisplayValues();
  const bgs = rng.getBackgrounds();
  const ocultas = [];
  for (let c = 1; c <= lastCol; c++) ocultas[c] = ws.isColumnHiddenByUser(c);
  if (LIMITE === 23) _ocultarColumnasVacias_(vals, ocultas, lastCol);

  let head = '', body = '';
  for (let r = 0; r < vals.length; r++) {
    let celdas = '';
    for (let c = 0; c < lastCol; c++) {
      if (ocultas[c + 1]) continue;
      if (r === 0) {
        celdas += '<th>' + esc_(vals[r][c]) + '</th>';
      } else {
        const bg = bgs[r][c];
        const st = (bg && bg.toLowerCase() !== '#ffffff') ? ' style="background:' + bg + '"' : '';
        celdas += '<td' + st + '>' + esc_(vals[r][c]) + '</td>';
      }
    }
    if (r === 0) head = '<tr>' + celdas + '</tr>'; else body += '<tr>' + celdas + '</tr>';
  }

  const MARGEN_MM = 10;
  const cssTop =
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box;}' +
    '.pagina{padding:' + MARGEN_MM + 'mm;}' +
    // La carátula está diseñada para vertical (una sola página, texto grande);
    // la tabla va en horizontal (hasta 17 columnas). Sin esto, la carátula
    // hereda el horizontal de la tabla, no cabe entera y se desborda a una
    // página 2 casi en blanco (visto en real, 2026-09-10 — mismo bug que ya
    // se arregló en Meco/_htmlImpresionCCM_, aquí se me olvidó aplicarlo).
    // "page" con nombre le da a SOLO la carátula su propio tamaño de página.
    '.pagina.caratula{page:caratula-arrastre;}' +
    '@page caratula-arrastre{size:portrait;margin:' + MARGEN_MM + 'mm;}' +
    // width:100% (sin escalado) le funciona bien a Meco (9 columnas), pero
    // con las 17 de arrastres el navegador recorta columnas enteras en vez de
    // encogerlas para que quepan (visto en real, 2026-09-10) — peor que dejar
    // margen. Se vuelve al escalado por JavaScript (como htmlImprimirTOP,
    // probado en producción), que SIEMPRE muestra las 17 columnas completas,
    // arreglando esta vez el cálculo para que también SE ESTIRE cuando la
    // tabla es más estrecha que el folio (no solo encoja cuando es más ancha).
    '#wrapTop{width:max-content;}' +
    'table{border-collapse:collapse;table-layout:auto;width:max-content !important;}' +
    'th,td{border:1px solid #555;padding:3px 5px;font-size:9px;text-align:left;white-space:nowrap;}' +
    'thead th{background:#333;color:#fff;}' +
    '@media print{@page{size:landscape;margin:' + MARGEN_MM + 'mm;}.salto{page-break-before:always;}}';

  // zoom en vez de transform:scale: mismo motivo que en _htmlImpresionRecepcion_
  // (transform solo pinta escalado, no recalcula saltos de página -> filas
  // cortadas al cambiar de folio; zoom reescala el layout de verdad).
  const script =
    'window.onload=function(){' +
    'var t=document.getElementById("tblArrastres");' +
    'var wrap=document.getElementById("wrapTop");' +
    'var mmToPx=96/25.4;' +
    'var avail=Math.floor((297-2*' + MARGEN_MM + ')*mmToPx)-4;' +
    'var w=t.offsetWidth;' +
    'var sc=avail/w;' +
    'wrap.style.zoom=sc;' +
    'window.focus();setTimeout(function(){window.print();},300);' +
    '};';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Impresión de arrastres</title>' +
    '<style>' + car.css + cssTop + '</style></head><body>' +
    car.cuerpo +
    '<div class="pagina salto"><div id="wrapTop"><table id="tblArrastres"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>' +
    '<scr' + 'ipt>' + script + '</scr' + 'ipt>' +
    '</body></html>';
  return { html: html };
}

/**
 * HTML de impresión automática para Recepción: SOLO la tabla de TOP, SIN
 * carátula (decisión del usuario: Recepción es retención en plataforma, no
 * arrastre — spec 2026-09-07, §2/§4.2). Mismo escalado por JavaScript que
 * _htmlImpresionArrastres_ (todas las columnas visibles, se estira o encoge
 * según haga falta) — TOP de Recepción llega hasta 39 columnas.
 */
function _htmlImpresionRecepcion_() {
  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(CFG.HOJAS.TOP);
  const u = ws ? ws.getLastRow() : 0;
  if (u < 1) return { error: 'La hoja TOP no tiene datos.' };

  const LIMITE = 39;
  const lastCol = Math.min(ws.getLastColumn(), LIMITE);
  const rng = ws.getRange(1, 1, u, lastCol);
  const vals = rng.getDisplayValues();
  const bgs = rng.getBackgrounds();
  const ocultas = [];
  for (let c = 1; c <= lastCol; c++) ocultas[c] = ws.isColumnHiddenByUser(c);

  // Agrupa las filas por Pedido (columna A) en su propio <tbody>, con
  // page-break-inside:avoid: si un pedido no cabe entero en lo que queda de
  // página, el navegador lo empuja ENTERO a la siguiente, en vez de partirlo
  // por la mitad entre dos hojas (pedido, 2026-09-10).
  let head = '';
  const grupos = [];
  let grupoActual = null, pedidoActual = null;
  for (let r = 0; r < vals.length; r++) {
    let celdas = '';
    for (let c = 0; c < lastCol; c++) {
      if (ocultas[c + 1]) continue;
      if (r === 0) {
        celdas += '<th>' + esc_(vals[r][c]) + '</th>';
      } else {
        const bg = bgs[r][c];
        const st = (bg && bg.toLowerCase() !== '#ffffff') ? ' style="background:' + bg + '"' : '';
        celdas += '<td' + st + '>' + esc_(vals[r][c]) + '</td>';
      }
    }
    if (r === 0) { head = '<tr>' + celdas + '</tr>'; continue; }
    const pedido = t_(vals[r][0]);
    if (pedido !== pedidoActual || !grupoActual) {
      grupoActual = [];
      grupos.push(grupoActual);
      pedidoActual = pedido;
    }
    grupoActual.push('<tr>' + celdas + '</tr>');
  }
  const body = grupos.map(g => '<tbody class="grupo">' + g.join('') + '</tbody>').join('');

  const MARGEN_MM = 10;
  const css =
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box;}' +
    '.pagina{padding:' + MARGEN_MM + 'mm;}' +
    '.tit{font-size:16px;font-weight:bold;margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;}' +
    '#wrapTop{width:max-content;}' +
    'table{border-collapse:collapse;table-layout:auto;width:max-content !important;}' +
    'th,td{border:1px solid #555;padding:3px 5px;font-size:9px;text-align:left;white-space:nowrap;}' +
    'thead th{background:#333;color:#fff;}' +
    '.grupo{break-inside:avoid;page-break-inside:avoid;}' +
    '@media print{@page{size:landscape;margin:' + MARGEN_MM + 'mm;}}';

  // OJO: "transform:scale" (como en htmlImprimirTOP) solo cambia el pintado,
  // no el layout: Chrome calcula los saltos de página ANTES de escalar, así
  // que una fila puede quedar "físicamente" dentro de un grupo sin partir
  // pero su posición pintada cae justo en el borde del folio y se corta
  // (visto en real, 2026-09-10). "zoom" sí reescala el layout de verdad (el
  // navegador recalcula cajas y saltos de página YA con el tamaño final), así
  // que .grupo{break-inside:avoid} funciona sobre la posición real impresa.
  const script =
    'window.onload=function(){' +
    'var t=document.getElementById("tblRecepcion");' +
    'var wrap=document.getElementById("wrapTop");' +
    'var mmToPx=96/25.4;' +
    'var avail=Math.floor((297-2*' + MARGEN_MM + ')*mmToPx)-4;' +
    'var w=t.offsetWidth;' +
    'var sc=avail/w;' +
    'wrap.style.zoom=sc;' +
    'window.focus();setTimeout(function(){window.print();},300);' +
    '};';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Impresión de recepción</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="pagina"><div class="tit">Retenidos Recepción</div><div id="wrapTop"><table id="tblRecepcion"><thead>' + head + '</thead>' + body + '</table></div></div>' +
    '<scr' + 'ipt>' + script + '</scr' + 'ipt>' +
    '</body></html>';
  return { html: html };
}
