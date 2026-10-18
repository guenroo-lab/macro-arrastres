/**
 * REGISTRO PARA ARGOS (2026-10-18, pedido de Pedro)
 * Argos (el cuadro de actividad de la plataforma) lee este documento para contar lo que el macro trata y hoy no deja anotado en ningún sitio.
 * Dos pestañas persistentes que SOLO se añaden filas (ni «Borrar TOP» ni «Borrar todo» las tocan; HISTORICO tampoco se toca, porque alimenta los
 * informes semanal y mensual por correo):
 *  - MECO_CCM  los soportes del CCM de Meco (los que nos quedamos y tratamos en plataforma), al procesar el ZIP de Meco.
 *              Una fila por pedido + Pyxis + soporte (SOP_ALM1) del Albarán de cada tienda.
 *  - SEPARADOS los pedidos que se separan de su soporte para que cada uno vaya en el suyo, al procesar arrastres (ver _separacionesDeTop_).
 * Columna Fecha = el día en que se procesa (texto dd/MM/aaaa, como HISTORICO). Si se repite el proceso el mismo día no se duplica nada.
 * Todo va protegido por quien lo llama: si algo falla aquí, la impresión, los retenidos y las etiquetas de HODOS siguen exactamente igual.
 */

const REG_MECO_COLS = ['Fecha', 'Tienda', 'Pedido', 'Pyxis', 'Soporte', 'Agrupacion', 'DiaPrevisto'];
const REG_SEP_COLS = ['Fecha', 'Tienda', 'Origen', 'Soporte', 'Pedido', 'Motivo'];

/** Pestaña de registro (se crea con su cabecera si no existe). */
function _hojaRegistroArgos_(nombre, cols) {
  const ss = SpreadsheetApp.getActive();
  let ws = ss.getSheetByName(nombre);
  if (!ws) {
    ws = ss.insertSheet(nombre);
    ws.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#080a10').setFontColor('#ffffff');
    ws.setFrozenRows(1);
  }
  return ws;
}

/** Claves de lo que ya está anotado HOY (basta mirar el final de la pestaña): evita duplicar si se repite el proceso o se sube dos veces el mismo ZIP. */
function _clavesDeHoyRegistro_(ws, cols, hoy, indicesClave) {
  const claves = {};
  const u = ws.getLastRow();
  if (u < 2) return claves;
  const desde = Math.max(2, u - 4999);
  ws.getRange(desde, 1, u - desde + 1, cols.length).getDisplayValues().forEach(r => {
    if (t_(r[0]) === hoy) claves[indicesClave.map(i => t_(r[i])).join('|')] = true;
  });
  return claves;
}

/**
 * Añade a la pestaña las filas nuevas de hoy (filas SIN la fecha: la pone esta función). indicesClave: columnas (con la Fecha en la 0) que identifican
 * una fila dentro del día. Devuelve cuántas se han añadido.
 */
function _anotarRegistroArgos_(nombre, cols, filas, indicesClave) {
  if (!filas || !filas.length) return 0;
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  const ws = _hojaRegistroArgos_(nombre, cols);
  const ya = _clavesDeHoyRegistro_(ws, cols, hoy, indicesClave);
  const nuevas = [];
  filas.forEach(f => {
    const fila = [hoy].concat(f).map(v => t_(v));
    const clave = indicesClave.map(i => fila[i]).join('|');
    if (ya[clave]) return;
    ya[clave] = true;
    nuevas.push(fila);
  });
  if (!nuevas.length) return 0;
  ws.getRange(ws.getLastRow() + 1, 1, nuevas.length, cols.length).setNumberFormat('@').setValues(nuevas);
  return nuevas.length;
}

/* ---------------- Meco: los soportes del CCM ---------------- */

/** Filas (sin Fecha) de los Albaranes del CCM: una por pedido + Pyxis + soporte. ccmPorTienda: { 'E036': blob, ... }. */
function _filasMecoCcm_(ccmPorTienda, fechaLlegada) {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dia = fechaLlegada ? Utilities.formatDate(fechaLlegada, tz, 'dd/MM/yyyy') : '';
  const out = [];
  Object.keys(ccmPorTienda).forEach(cod => {
    const tienda = MECO_TIENDA_NOMBRE[cod] || cod;
    const visto = {};
    _albaranAFilasTOP_(ccmPorTienda[cod]).forEach(f => {
      const pedido = t_(f[7]), pyxis = t_(f[15]), soporte = t_(f[18]);
      const clave = pedido + '|' + pyxis + '|' + soporte;
      if (visto[clave]) return;                       // el Albarán trae una fila por línea (LM): el soporte se anota una vez
      visto[clave] = true;
      out.push([tienda, pedido, pyxis, soporte, t_(f[19]), dia]);
    });
  });
  return out;
}

/** Anota en MECO_CCM los soportes del CCM del ZIP de Meco. Devuelve cuántas filas nuevas. */
function _guardarMecoCcm_(ccmPorTienda, fechaLlegada) {
  return _anotarRegistroArgos_('MECO_CCM', REG_MECO_COLS, _filasMecoCcm_(ccmPorTienda, fechaLlegada), [1, 2, 3, 4]);
}

/* ---------------- Pedidos separados ---------------- */

/**
 * Los pedidos que se SEPARAN de su soporte (Pedro, 2026-10-18): cuando varios pedidos vienen en un mismo soporte y son de cerámica, se saca cada pedido y va en un
 * soporte individual. En MÁLAGA se hace con toda la cerámica, tenga transporte o no (también la de tránsito de Antequera y los pedidos 99); en las DEMÁS tiendas
 * (Marbella, Mijas) solo con la cerámica que tiene transporte. Un soporte con un solo pedido ya va solo: no hay nada que separar.
 * Cuenta los pedidos de cerámica de cada soporte con más de un pedido (todos los pedidos del soporte, sean o no de cerámica, para saber si se comparte).
 *   filas: TOP ya procesado (fila 0 = cabecera); ceramica: { lm: true } (_catalogoCeramica_); transporte: { pyxis: 'SI'|'NO'|'' } (_transportePorPyxis_);
 *   pyxisPorPegase: { pegase: pyxis } (_pyxisPorPegase_: el CC de proveedor directo llega sin Pyxis); c: índices { cA, cG, cJ, cK, cP, cS, cT }.
 * Devuelve [{ tienda, origen, soporte, pedido, motivo }]: una por pedido y soporte, que es también un soporte nuevo (cada pedido separado va en el suyo).
 */
function _separacionesDeTop_(filas, ceramica, transporte, pyxisPorPegase, c) {
  const TIENDAS = { 'MALAGA': 'Málaga', 'MARBELLA': 'Marbella', 'MIJAS': 'Mijas' };
  const soportes = {}, orden = [];
  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const gNorm = t_(fila[c.cG]).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tienda = TIENDAS[gNorm];
    if (!tienda) continue;
    const soporte = t_(fila[c.cP]);
    let pedido = t_(fila[c.cK]);
    if (pedido === '') pedido = pyxisPorPegase[t_(fila[c.cJ])] || '';
    if (pedido === '' || soporte === '') continue;
    const clave = tienda + '|' + soporte;
    if (!(clave in soportes)) { soportes[clave] = { tienda: tienda, soporte: soporte, origen: t_(fila[c.cA]) || 'Arrastre', pedidos: {}, ceramica: {} }; orden.push(clave); }
    const S = soportes[clave];
    S.pedidos[pedido] = true;
    const lm = _lmDeFila_(fila, c.cS, c.cT);
    if (lm !== '' && (lm in ceramica)) S.ceramica[pedido] = true;
  }
  const out = [];
  orden.forEach(clave => {
    const S = soportes[clave];
    if (Object.keys(S.pedidos).length < 2) return;
    Object.keys(S.ceramica).forEach(p => {
      if (S.tienda !== 'Málaga' && transporte[p] !== 'SI') return;
      out.push({ tienda: S.tienda, origen: S.origen, soporte: S.soporte, pedido: p, motivo: S.tienda === 'Málaga' ? 'Cerámica de Málaga' : 'Cerámica con transporte' });
    });
  });
  return out;
}

/** Anota en SEPARADOS las separaciones de hoy. Devuelve cuántas filas nuevas. */
function _guardarSeparados_(lista) {
  return _anotarRegistroArgos_('SEPARADOS', REG_SEP_COLS, lista.map(s => [s.tienda, s.origen, s.soporte, s.pedido, s.motivo]), [1, 3, 4]);
}

/** Resumen para el mensaje de procesarArrastres: pedidos distintos separados, soportes nuevos (uno por pedido y soporte) y el reparto por tienda. */
function _resumenSeparados_(lista) {
  const pedidos = {}, porTienda = {};
  lista.forEach(s => { pedidos[s.tienda + '|' + s.pedido] = true; porTienda[s.tienda] = (porTienda[s.tienda] || 0) + 1; });
  return { pedidos: Object.keys(pedidos).length, soportes: lista.length, porTienda: porTienda };
}
