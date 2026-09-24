/**
 * REGISTRO ÚNICO DE RETENIDOS
 * Una sola hoja RETENIDOS con un bloque por tienda (Málaga, Marbella, Mijas).
 * Tanto arrastres como recepción AÑADEN aquí sin sobrescribir; los registros se
 * acumulan durante el día y se vacían en el borrado de las 3:00.
 *
 * Cada bloque (9 columnas): Tipo | Flete | Pedido | Pyxis | Agrupación | SSCC |
 * Expedición | Enviado | Día.
 * 'Flete' solo en arrastres; 'Expedición' se rellena a mano; 'Enviado' lo sella
 * el botón de envío; 'Día' es la fecha de salida calculada por origen.
 */

/** Devuelve la hoja RETENIDOS, creándola si no existe */
function hojaRetenidos_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(CFG.HOJAS.RETENIDOS) || ss.insertSheet(CFG.HOJAS.RETENIDOS);
}

/** Construye las cabeceras de los 4 bloques (no toca los datos ya escritos) */
function prepararCabecerasRetenidos_(ws) {
  const ancho = CFG.RETEN_COLS.length;
  // Desmerge y limpia las dos filas de cabecera en todo el ancho, para que no
  // queden títulos antiguos/duplicados de una distribución anterior de bloques.
  const maxC = ws.getMaxColumns();
  try { ws.getRange(1, 1, 2, maxC).breakApart(); } catch (e) {}
  ws.getRange(1, 1, 2, maxC).clearContent();

  CFG.RETEN_BLOQUES.forEach(b => {
    ws.getRange(1, b.col, 1, ancho).merge().setValue(b.nombre)
      .setBackground(b.color).setFontWeight('bold').setFontSize(14)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true);
    ws.getRange(2, b.col, 1, ancho).setValues([CFG.RETEN_COLS])
      .setBackground(b.color).setFontWeight('bold').setHorizontalAlignment('center')
      .setBorder(true, true, true, true, true, true);
  });
}

/** Detalle vacío (nuevos/repetidos a 0 por tienda) con la forma estándar. */
function _detalleVacioRetenidos_() {
  const d = { _sinBloque: 0 };
  CFG.RETEN_BLOQUES.forEach(b => d[b.nombre] = { nuevos: 0, repetidos: 0 });
  return d;
}

/**
 * Añade registros al registro único, agrupando por tienda y evitando duplicados.
 * registros: [{ tienda, tipo, pedido, pyxis, agrupacion, sscc }]
 * Devuelve SIEMPRE { total, detalle } (también con lista vacía), para que los
 * procesos puedan leer res.detalle sin comprobar el tipo.
 */
function registrarRetenidos_(registros) {
  if (!registros || !registros.length) return { total: 0, detalle: _detalleVacioRetenidos_() };
  const ws = hojaRetenidos_();
  const ancho = CFG.RETEN_COLS.length;

  // Reconstruir cabeceras si la hoja está vacía (p. ej. tras el reset diario)
  if (ws.getLastRow() < 2 || t_(ws.getRange(1, CFG.RETEN_BLOQUES[0].col).getValue()) === '') {
    ws.clear();
    prepararCabecerasRetenidos_(ws);
  }

  // Mapa de bloques por nombre de tienda (columna REAL localizada por su título)
  const bloque = {};
  CFG.RETEN_BLOQUES.forEach(b => {
    bloque[b.nombre] = { col: _colDeBloque_(ws, b.nombre), color: b.color, claves: {}, sig: 3, nuevas: [] };
  });
  const maxCol = Math.max.apply(null, CFG.RETEN_BLOQUES.map(b => bloque[b.nombre].col));

  // Leer lo ya existente de una sola vez para deducir claves y última fila por bloque
  const ultFila = Math.max(ws.getLastRow(), 2);
  const datos = ultFila >= 3
    ? ws.getRange(3, 1, ultFila - 2, maxCol + ancho - 1).getValues()
    : [];

  // Claves existentes y siguiente fila libre por bloque
  datos.forEach((fila, r) => {
    CFG.RETEN_BLOQUES.forEach(b => {
      const blk = bloque[b.nombre];
      const o = blk.col - 1; // offset 0-based
      const tipo = t_(fila[o]), pedido = t_(fila[o + 2]), pyxis = t_(fila[o + 3]), sscc = t_(fila[o + 5]);
      if (pedido !== '' || tipo !== '') {
        const k = tipo + '|' + pedido + '|' + pyxis + '|' + sscc;
        blk.claves[k] = true;
        blk.sig = 3 + r + 1; // una fila por debajo de la última con datos
      }
    });
  });

  // Clasificar registros nuevos
  let total = 0;
  const detalle = _detalleVacioRetenidos_();
  registros.forEach(reg => {
    const b = bloque[reg.tienda];
    if (!b) { detalle._sinBloque++; return; }
    const k = t_(reg.tipo) + '|' + t_(reg.pedido) + '|' + t_(reg.pyxis) + '|' + t_(reg.sscc);
    if (b.claves[k]) { detalle[reg.tienda].repetidos++; return; }
    b.claves[k] = true;
    b.nuevas.push([reg.tipo, reg.flete || '', reg.pedido, reg.pyxis, reg.agrupacion, reg.sscc, reg.expedicion || '', '', _fechaEnvioPorOrigen_(reg.tipo)]);
    detalle[reg.tienda].nuevos++;
    total++;
  });

  // Escribir por bloque (una sola escritura + formato por bloque)
  CFG.RETEN_BLOQUES.forEach(b => {
    const blk = bloque[b.nombre];
    if (!blk.nuevas.length) return;
    const rng = ws.getRange(blk.sig, blk.col, blk.nuevas.length, ancho);
    rng.setNumberFormat('@'); // texto: conserva SSCC y pedidos largos sin notación científica
    rng.setValues(blk.nuevas);
    rng.setBorder(true, true, true, true, true, true);
  });

  autoajustar_(ws, 1, CFG.RETEN_BLOQUES[CFG.RETEN_BLOQUES.length - 1].col + ancho - 1);
  return { total: total, detalle: detalle };
}

/** Ir a la hoja de retenidos */
/** Vaciar el registro de retenidos (deja las cabeceras limpias) */
function vaciarRetenidos() {
  const ws = hojaRetenidos_();
  ws.clear();
  prepararCabecerasRetenidos_(ws);
  SpreadsheetApp.getActive().toast('Retenidos vaciados.', '🗑️ Retenidos', 4);
}

/** Vaciar retenidos con confirmación (menú) */
function vaciarRetenidosMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Vaciar retenidos', '¿Seguro que quieres borrar todos los retenidos del día?',
      ui.ButtonSet.YES_NO) === ui.Button.YES) {
    vaciarRetenidos();
  }
}

/* ============== AÑADIR / QUITAR (desde el panel) ============== */

/** Devuelve la definición de bloque por nombre de tienda, o null */
function _bloquePorNombre_(nombre) {
  return CFG.RETEN_BLOQUES.filter(b => b.nombre === nombre)[0] || null;
}

/**
 * Columna REAL donde está el bloque de una tienda: busca el título (p. ej.
 * "Marbella") en la fila 1 de la hoja. Si no lo encuentra (hoja aún sin crear),
 * usa la posición de CFG. Así la lectura/escritura nunca se descuadra aunque la
 * hoja y el Config tengan posiciones distintas.
 */
function _colDeBloque_(ws, nombre) {
  const lastCol = ws.getLastColumn();
  if (lastCol >= 1) {
    const fila1 = ws.getRange(1, 1, 1, lastCol).getValues()[0];
    for (let c = 0; c < fila1.length; c++) {
      if (t_(fila1[c]) === nombre) return c + 1;
    }
  }
  const b = _bloquePorNombre_(nombre);
  return b ? b.col : null;
}

/**
 * Fecha de salida a tienda ("Día") según el origen (Tipo), usando CFG.DIA_POR_ORIGEN.
 * Si el resultado cae en fin de semana (p. ej. viernes + 1 día = sábado), se pasa
 * al lunes siguiente, porque no hay envíos en fin de semana.
 * Devuelve 'dd/MM/yyyy'. Lo no listado (p. ej. "Manual") sale hoy.
 * `fechaBase` (Date, opcional) calcula desde OTRA fecha en vez de "hoy" — p. ej.
 * la FECHA del Albaran de Meco (ver MecoAlbaran.gs). Sin ella, igual que siempre.
 */
function _fechaEnvioPorOrigen_(tipo, fechaBase) {
  const t = t_(tipo);
  const off = CFG.DIA_POR_ORIGEN.hasOwnProperty(t) ? CFG.DIA_POR_ORIGEN[t] : 0;
  const d = fechaBase ? new Date(fechaBase.getTime()) : new Date();
  d.setDate(d.getDate() + off);
  const dow = d.getDay();                 // 0 = domingo, 6 = sábado
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
}

/**
 * Compara dos valores de "Pedido" de forma tolerante: iguales como texto, o
 * iguales como número (cubre "036467" vs "36467", "467" vs "467.0", etc.
 * que pueden darse al venir de celdas numéricas de Sheets).
 */
function _pedidoCoincide_(a, b) {
  const sa = t_(a), sb = t_(b);
  if (sa === sb) return true;
  if (sa === '' || sb === '') return false;
  const na = Number(sa), nb = Number(sb);
  return !isNaN(na) && !isNaN(nb) && na === nb;
}

/** Lee las filas con datos de un bloque (array de arrays de ancho RETEN_COLS) */
function _leerBloque_(ws, bloque) {
  const ancho = CFG.RETEN_COLS.length;
  const col = _colDeBloque_(ws, bloque.nombre);
  const last = ws.getLastRow();
  if (last < 3 || !col) return [];
  return ws.getRange(3, col, last - 2, ancho).getValues()
    .filter(r => t_(r[2]) !== '' || t_(r[0]) !== '');
}

/** Reescribe (compacta) las filas de un bloque, dejando intactas las cabeceras */
function _escribirBloque_(ws, bloque, filas) {
  const ancho = CFG.RETEN_COLS.length;
  const col = _colDeBloque_(ws, bloque.nombre);
  const last = ws.getLastRow();
  if (last >= 3) ws.getRange(3, col, last - 2, ancho).clear();
  if (filas.length) {
    const rng = ws.getRange(3, col, filas.length, ancho);
    rng.setNumberFormat('@');
    rng.setValues(filas);
    rng.setBorder(true, true, true, true, true, true);
  }
  autoajustar_(ws, col, ancho);
}

/**
 * Añade un retenido manualmente a una tienda (sin duplicar).
 * Devuelve un mensaje para el panel.
 */
function anadirRetenido(tienda, tipo, pedido, pyxis, agrupacion, sscc, expedicion) {
  if (!_bloquePorNombre_(tienda)) throw new Error('Tienda no válida.');
  if (t_(pedido) === '') throw new Error('El Pedido es obligatorio.');
  const n = registrarRetenidos_([{
    tienda: tienda, tipo: t_(tipo) || 'Manual', pedido: pedido,
    pyxis: pyxis || '', agrupacion: agrupacion || '', sscc: sscc || '',
    expedicion: expedicion || ''
  }]).total;
  return n
    ? ('Añadido a ' + tienda + ' (pedido ' + t_(pedido) + ').')
    : ('Ese soporte ya estaba en ' + tienda + ' (no se duplica).');
}

/**
 * Lista los soportes retenidos de un pedido en una tienda.
 * Devuelve [{ key, tipo, pedido, pyxis, agrupacion, sscc, expedicion, enviado }]
 */
function listarRetenidosPedido(tienda, pedido) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  const ped = t_(pedido);
  if (ped === '') throw new Error('Escribe un pedido.');
  const ws = hojaRetenidos_();
  return _leerBloque_(ws, bloque)
    .filter(r => _pedidoCoincide_(r[2], ped))
    .map(r => ({
      key: t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]),
      tipo: t_(r[0]), flete: t_(r[1]), pedido: t_(r[2]), pyxis: t_(r[3]),
      agrupacion: t_(r[4]), sscc: t_(r[5]), expedicion: t_(r[6]), enviado: t_(r[7]), dia: t_(r[8])
    }));
}

/**
 * Lista TODOS los retenidos de una tienda (vista visual del tab "Retenidos del
 * día" en la web: por tienda, no por pedido — a diferencia de
 * listarRetenidosPedido, que exige un pedido concreto).
 * Devuelve [{ key, tipo, pedido, pyxis, agrupacion, sscc, expedicion, enviado, dia }]
 */
function listarRetenidosTienda(tienda) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  const ws = hojaRetenidos_();
  return _leerBloque_(ws, bloque).map(r => ({
    key: t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]),
    tipo: t_(r[0]), flete: t_(r[1]), pedido: t_(r[2]), pyxis: t_(r[3]),
    agrupacion: t_(r[4]), sscc: t_(r[5]), expedicion: t_(r[6]), enviado: t_(r[7]), dia: t_(r[8])
  }));
}

/**
 * Quita los soportes seleccionados (por clave) de una tienda, de CUALQUIER
 * pedido — a diferencia de quitarSoportes, que exige fijar antes un pedido.
 * Pensado para la vista visual (selección libre entre varios pedidos a la vez).
 */
function quitarClaves(tienda, claves) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  if (!claves || !claves.length) throw new Error('No has seleccionado ningún soporte.');
  const set = {};
  claves.forEach(k => { set[k] = true; });
  const ws = hojaRetenidos_();
  let quitadas = 0;
  const restantes = _leerBloque_(ws, bloque).filter(r => {
    const k = t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]);
    if (set[k]) { quitadas++; return false; }
    return true;
  });
  _escribirBloque_(ws, bloque, restantes);
  return quitadas;
}

/**
 * Cambia la fecha de salida ("Día") de los soportes seleccionados en una
 * tienda. nuevaFecha en 'dd/MM/yyyy' (mismo formato que _fechaEnvioPorOrigen_).
 */
function moverFechaRetenidos(tienda, claves, nuevaFecha) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  if (!claves || !claves.length) throw new Error('No has seleccionado ningún soporte.');
  const f = t_(nuevaFecha);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(f)) throw new Error('Fecha no válida (formato dd/mm/aaaa).');
  const set = {};
  claves.forEach(k => { set[k] = true; });
  const ws = hojaRetenidos_();
  let movidas = 0;
  const filas = _leerBloque_(ws, bloque).map(r => {
    const k = t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]);
    if (!set[k]) return r;
    movidas++;
    const nueva = r.slice();
    nueva[8] = f;
    return nueva;
  });
  _escribirBloque_(ws, bloque, filas);
  return movidas;
}

/**
 * Rellena/sobrescribe la Expedición de los soportes seleccionados en una
 * tienda, en bloque (mismo patrón que moverFechaRetenidos, columna 6 en vez
 * de la 8) — para poder añadirla a mano a varios pedidos a la vez.
 */
function moverExpedicionRetenidos(tienda, claves, nuevaExpedicion) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  if (!claves || !claves.length) throw new Error('No has seleccionado ningún soporte.');
  const exp = t_(nuevaExpedicion);
  if (!exp) throw new Error('Escribe la expedición.');
  const set = {};
  claves.forEach(k => { set[k] = true; });
  const ws = hojaRetenidos_();
  let movidas = 0;
  const filas = _leerBloque_(ws, bloque).map(r => {
    const k = t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]);
    if (!set[k]) return r;
    movidas++;
    const nueva = r.slice();
    nueva[6] = exp;
    return nueva;
  });
  _escribirBloque_(ws, bloque, filas);
  return movidas;
}

/** Quita los soportes seleccionados (por clave) de un pedido en una tienda */
function quitarSoportes(tienda, pedido, claves) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  if (!claves || !claves.length) throw new Error('No has seleccionado ningún soporte.');
  const set = {};
  claves.forEach(k => { set[k] = true; });
  const ped = t_(pedido);
  const ws = hojaRetenidos_();
  let quitadas = 0;
  const restantes = _leerBloque_(ws, bloque).filter(r => {
    const k = t_(r[0]) + '|' + t_(r[2]) + '|' + t_(r[3]) + '|' + t_(r[5]);
    const fuera = _pedidoCoincide_(r[2], ped) && set[k];
    if (fuera) quitadas++;
    return !fuera;
  });
  _escribirBloque_(ws, bloque, restantes);
  return quitadas;
}

/** Quita TODAS las líneas de un pedido en una tienda */
function quitarPedido(tienda, pedido) {
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida.');
  const ped = t_(pedido);
  if (ped === '') throw new Error('Escribe un pedido.');
  const ws = hojaRetenidos_();
  let quitadas = 0;
  const restantes = _leerBloque_(ws, bloque).filter(r => {
    const fuera = _pedidoCoincide_(r[2], ped);
    if (fuera) quitadas++;
    return !fuera;
  });
  _escribirBloque_(ws, bloque, restantes);
  return quitadas;
}
