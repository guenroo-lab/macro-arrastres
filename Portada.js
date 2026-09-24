/**
 * IMPORTAR RETENIDOS DE PORTADA
 * Lee la hoja del programa de Retenciones de Recepción (portada) y añade los
 * retenidos del DÍA a la hoja RETENIDOS unificada, sin duplicar.
 * No toca el programa de portada: solo lee.
 *
 * Mapeo (según la hoja de portada):
 *   Columna A -> Fecha   (se filtra solo lo de HOY)
 *   Columna B -> Tienda  (Marbella / Mijas)
 *   Columna C -> Pedido
 *   Columna F -> SSCC
 *   Pyxis     -> siempre "LS-SIE"
 *
 * Requisito: la cuenta que ejecuta esta macro debe tener acceso (al menos
 * lectura) al documento CFG.PORTADA_SHEET_ID.
 */
function importarRetenidosPortada() {
  const ss = SpreadsheetApp.getActive();

  let ext;
  try {
    ext = SpreadsheetApp.openById(CFG.PORTADA_SHEET_ID);
  } catch (e) {
    ss.toast('No puedo abrir el documento de portada. ¿Tienes acceso a ese archivo?', '⚠️ Portada', 6);
    throw new Error('No se puede abrir la hoja de portada: ' + e.message);
  }

  const hoja = ext.getSheetByName(CFG.PORTADA_TAB) || ext.getSheets()[0];
  if (!hoja) {
    ss.toast('No encuentro la pestaña de portada.', '⚠️ Portada', 6);
    return 'Sin pestaña.';
  }

  // Leemos el valor MOSTRADO (texto tal cual se ve): evita el desfase de un día
  // por zona horaria al leer fechas de otro documento y conserva el SSCC con ceros.
  const data = hoja.getDataRange().getDisplayValues();
  const tz = ss.getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const registros = [];
  let deHoy = 0, sinTienda = 0, ejemploFecha = '';
  // En portada un pedido ocupa VARIAS filas: la primera trae Fecha/Tienda/Pedido
  // y las siguientes solo el SSCC (col F). Arrastramos la cabecera hacia abajo.
  let curFechaISO = '', curTienda = '', curPedido = '';
  for (let i = 1; i < data.length; i++) {
    const f = data[i];
    // A=fecha(0) B=tienda(1) C=pedido(2) F=sscc(5)
    const tieneFecha = (f[0] instanceof Date) || t_(f[0]) !== '';
    if (tieneFecha) {                        // fila cabecera de un pedido
      curFechaISO = _fechaPortadaISO_(f[0], tz);
      curTienda = _tiendaPortada_(f[1]);
      curPedido = t_(f[2]);
      if (!ejemploFecha) ejemploFecha = t_(f[0]) + ' -> ' + curFechaISO;
    }

    const sscc = t_(f[5]);
    if (sscc === '') continue;               // fila sin SSCC: nada que añadir
    if (curFechaISO !== hoy) continue;       // solo HOY
    deHoy++;
    if (!curTienda) { sinTienda++; continue; }
    if (curPedido === '') continue;

    registros.push({
      tienda: curTienda,
      tipo: 'Recepción de Portada',
      pedido: curPedido,
      pyxis: 'LS-SIE',          // Pyxis siempre LS-SIE
      agrupacion: '',
      sscc: sscc,               // F -> SSCC
      expedicion: ''            // se rellena a mano
    });
  }

  if (!deHoy) {
    const diag = 'Hoy=' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy') +
                 (ejemploFecha ? ' · 1ª fecha leída: ' + ejemploFecha : ' · no leí ninguna fecha');
    ss.toast('No hay retenidos de portada con fecha de hoy. (' + diag + ')', '📥 Portada', 10);
    return 'Sin retenidos de hoy. ' + diag;
  }
  if (!registros.length) {
    ss.toast('Hay ' + deHoy + ' de hoy, pero ninguno con tienda Marbella/Mijas válida.', '⚠️ Portada', 6);
    return 'Sin tiendas válidas.';
  }

  const nuevos = registrarRetenidos_(registros).total;
  let msg = nuevos
    ? ('Portada: ' + nuevos + ' soporte(s) añadido(s) de ' + registros.length + ' de hoy.')
    : ('Portada: los ' + registros.length + ' de hoy ya estaban en la lista.');
  if (sinTienda) msg += ' (' + sinTienda + ' sin tienda válida, omitidos)';
  ss.toast(msg, '📥 Portada', 6);
  return msg;
}

/** Normaliza la tienda de portada (col B) a 'Marbella' / 'Mijas', o '' si no aplica */
function _tiendaPortada_(valor) {
  const s = t_(valor).toUpperCase();
  if (s.indexOf('MARBELLA') !== -1 || s === '014' || s === 'E014') return 'Marbella';
  if (s.indexOf('MIJAS') !== -1 || s === '279' || s === 'E279') return 'Mijas';
  return '';
}

/** Normaliza la fecha de portada (Date o 'd/m/yyyy', con o sin hora) a 'yyyy-MM-dd' */
function _fechaPortadaISO_(valor, tz) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, tz, 'yyyy-MM-dd');
  }
  const s = t_(valor).split(' ')[0];   // quita la hora si la trae
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return s;
}
