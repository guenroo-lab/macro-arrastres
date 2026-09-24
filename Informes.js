/**
 * INFORMES DE RETENIDOS
 * - Histórico: cada soporte (SSCC) enviado se guarda en la hoja HISTORICO.
 * - Informes semanal y mensual por email HTML (global plataforma + por tienda + flujo).
 * Los disparadores se crean con "Activar automatizaciones".
 */

const HIST_COLS = ['Fecha', 'Tienda', 'Flujo', 'Origen', 'Pedido', 'Pyxis', 'SSCC', 'DiaPrevisto'];
const TIENDAS_INF = ['Málaga', 'Marbella', 'Mijas'];

/** Hoja HISTORICO (se crea si no existe) */
function _hojaHistorico_() {
  const ss = SpreadsheetApp.getActive();
  let ws = ss.getSheetByName(CFG.HOJAS.HISTORICO);
  if (!ws) {
    ws = ss.insertSheet(CFG.HOJAS.HISTORICO);
    ws.getRange(1, 1, 1, HIST_COLS.length).setValues([HIST_COLS])
      .setFontWeight('bold').setBackground('#080a10').setFontColor('#ffffff');
    ws.setFrozenRows(1);
  }
  return ws;
}

/** Flujo a partir del Pyxis: 'LS-SIE' si el Pyxis es LS-SIE; si no, 'CC'. */
function _flujoDe_(pyxis) {
  return t_(pyxis).toUpperCase() === 'LS-SIE' ? 'LS-SIE' : 'CC';
}

/**
 * Guarda en HISTORICO las filas que se acaban de enviar.
 * datos[i] = [Tipo,Flete,Pedido,Pyxis,Agrup,SSCC,Exped,Enviado,Día]
 */
function _guardarHistorico_(tienda, datos, pend) {
  if (!pend || !pend.length) return;
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  const filas = pend.map(i => {
    const r = datos[i];
    return [hoy, tienda, _flujoDe_(r[3]), t_(r[0]), t_(r[2]), t_(r[3]), t_(r[5]), t_(r[8])];
  });
  const ws = _hojaHistorico_();
  ws.getRange(ws.getLastRow() + 1, 1, filas.length, HIST_COLS.length)
    .setNumberFormat('@').setValues(filas);
}

/* ---------------- Fechas ---------------- */
function _intFecha_(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function _ddmmAInt_(s) {
  const m = t_(s).split(' ')[0].match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  return m ? (parseInt(m[3], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10)) : 0;
}
function _fmtFecha_(d) {
  return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
}

/* ---------------- Agregación ---------------- */
function _agregarHistorico_(ini, fin) {
  const ws = _hojaHistorico_();
  const u = ws.getLastRow();
  const mk = () => ({ sop: 0, ped: {}, lsSop: 0, ccSop: 0, lsPed: {}, ccPed: {}, env: {}, enPlazo: 0, orig: {} });
  const acc = { TOTAL: mk() };
  TIENDAS_INF.forEach(t => acc[t] = mk());

  if (u >= 2) {
    const data = ws.getRange(2, 1, u - 1, HIST_COLS.length).getValues();
    data.forEach(r => {
      const f = _ddmmAInt_(t_(r[0]));
      if (f < ini || f > fin) return;
      const tienda = t_(r[1]);
      if (!acc[tienda]) return;
      const flujo = t_(r[2]), origen = t_(r[3]) || '(sin origen)', pedido = t_(r[4]);
      const enPlazo = (t_(r[7]) !== '' && t_(r[7]) === t_(r[0]));
      [acc[tienda], acc.TOTAL].forEach(a => {
        a.sop++; a.ped[pedido] = 1; a.env[t_(r[0]) + '|' + tienda] = 1;
        if (flujo === 'LS-SIE') { a.lsSop++; a.lsPed[pedido] = 1; }
        else { a.ccSop++; a.ccPed[pedido] = 1; }
        if (enPlazo) a.enPlazo++;
        if (!a.orig[origen]) a.orig[origen] = { sop: 0, ped: {} };
        a.orig[origen].sop++; a.orig[origen].ped[pedido] = 1;
      });
    });
  }
  const out = {};
  Object.keys(acc).forEach(k => {
    const a = acc[k];
    const orig = {};
    Object.keys(a.orig).forEach(o => { orig[o] = { sop: a.orig[o].sop, ped: Object.keys(a.orig[o].ped).length }; });
    out[k] = {
      sop: a.sop, ped: Object.keys(a.ped).length,
      lsSop: a.lsSop, ccSop: a.ccSop,
      lsPed: Object.keys(a.lsPed).length, ccPed: Object.keys(a.ccPed).length,
      env: Object.keys(a.env).length, enPlazo: a.enPlazo, orig: orig
    };
  });
  return out;
}

/* ---------------- Informes (entradas) ---------------- */
function informeSemanal() {
  const hoy = new Date();
  const dow = (hoy.getDay() + 6) % 7;                 // 0 = lunes
  const finDom = new Date(hoy); finDom.setDate(hoy.getDate() - dow - 1);   // domingo pasado
  const iniLun = new Date(finDom); iniLun.setDate(finDom.getDate() - 6);   // lunes pasado
  const pFin = new Date(iniLun); pFin.setDate(iniLun.getDate() - 1);
  const pIni = new Date(pFin); pIni.setDate(pFin.getDate() - 6);
  _enviarInforme_('Informe SEMANAL de retenidos',
    _fmtFecha_(iniLun) + ' – ' + _fmtFecha_(finDom),
    _agregarHistorico_(_intFecha_(iniLun), _intFecha_(finDom)),
    _agregarHistorico_(_intFecha_(pIni), _intFecha_(pFin)), 'semana');
}

function informeMensual() {
  const hoy = new Date();
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth(), 0);            // último día mes anterior
  const iniMes = new Date(finMes.getFullYear(), finMes.getMonth(), 1);
  const pFin = new Date(iniMes.getFullYear(), iniMes.getMonth(), 0);
  const pIni = new Date(pFin.getFullYear(), pFin.getMonth(), 1);
  _enviarInforme_('Informe MENSUAL de retenidos',
    _fmtFecha_(iniMes) + ' – ' + _fmtFecha_(finMes),
    _agregarHistorico_(_intFecha_(iniMes), _intFecha_(finMes)),
    _agregarHistorico_(_intFecha_(pIni), _intFecha_(pFin)), 'mes');
}

function _enviarInforme_(titulo, periodo, agg, prev, unidad) {
  if (agg.TOTAL.sop === 0) {
    SpreadsheetApp.getActive().toast('Sin retenidos en el periodo (' + periodo + '). No se envía informe.', '📊', 6);
    return 'sin_datos';
  }
  // Global a administración (tabla con todas las tiendas)
  const htmlG = _emailInformeHTML_(titulo, periodo, agg, prev, unidad);
  enviarCorreo_(CFG.INFORMES_PARA.join(','), titulo + ' · plataforma · ' + periodo, htmlG,
    'Resumen de los soportes y pedidos retenidos y consolidados en la plataforma de Málaga (' + periodo + '), con desglose por tienda, flujo (LS-SIE/CC) y procedencia.');

  // Un correo por tienda (solo sus datos)
  TIENDAS_INF.forEach(t => {
    const a = agg[t];
    if (!a || a.sop === 0) return;
    const para = (CFG.INFORMES_TIENDA[t] || []).join(',');
    if (!para) return;
    const cc = (CFG.INFORMES_CC || []).join(',');
    const htmlT = _emailInformeTiendaHTML_(titulo, periodo, t, a, prev[t] || {}, unidad);
    enviarCorreo_(para, titulo + ' · ' + t + ' · ' + periodo, htmlT,
      'Soportes y pedidos retenidos y consolidados para ' + t + ' (' + periodo + '), con detalle por flujo (LS-SIE/CC) y procedencia.',
      cc);
  });

  SpreadsheetApp.getActive().toast('Informe enviado (plataforma + tiendas) · ' + periodo, '📊 Informe', 6);
  return 'ok';
}

/* ---------------- Email HTML (oscuro, compatible Outlook) ---------------- */
function _delta_(now, was, unidad) {
  if (was === 0) return now > 0 ? '<span style="color:#7CFC9B">▲ nuevo</span>' : '';
  const d = now - was, pct = Math.round(Math.abs(d) * 100 / was);
  if (d > 0) return '<span style="color:#7CFC9B">▲ ' + pct + '% vs ' + unidad + ' ant.</span>';
  if (d < 0) return '<span style="color:#ff7b7b">▼ ' + pct + '% vs ' + unidad + ' ant.</span>';
  return '<span style="color:#9aa3b2">= igual</span>';
}

function _kpi_(valor, etiqueta, extra) {
  return '<td align="center" style="padding:14px 10px;background:#11151f;border:1px solid #1e2430;border-radius:8px">' +
    '<div style="font-family:Arial;font-size:26px;font-weight:bold;color:#ffffff">' + valor + '</div>' +
    '<div style="font-family:Arial;font-size:11px;color:#9aa3b2;text-transform:uppercase;letter-spacing:.5px">' + etiqueta + '</div>' +
    (extra ? '<div style="font-family:Arial;font-size:11px;margin-top:3px">' + extra + '</div>' : '') +
    '</td>';
}

function _cabecera_(titulo, periodo) {
  return '<tr><td style="padding:18px 20px;background:#0e1118;border-left:5px solid #e30613;border-radius:8px">' +
    '<div style="font-family:Arial;font-size:22px;font-weight:bold;color:#ffffff">' + titulo + '</div>' +
    '<div style="font-family:Arial;font-size:13px;color:#9aa3b2;margin-top:2px">Periodo: ' + periodo + '</div>' +
    '</td></tr><tr><td style="height:14px"></td></tr>';
}

function _kpis_(a, p, unidad) {
  return '<tr><td><table width="100%" cellpadding="0" cellspacing="6"><tr>' +
    _kpi_(a.sop, 'Soportes', _delta_(a.sop, p.sop || 0, unidad)) +
    _kpi_(a.ped, 'Pedidos', _delta_(a.ped, p.ped || 0, unidad)) +
    _kpi_(a.lsSop, 'LS-SIE', '') +
    _kpi_(a.ccSop, 'CC', '') +
    '</tr></table></td></tr><tr><td style="height:16px"></td></tr>';
}

function _wrap_(inner) {
  return '<div style="background:#080a10;padding:22px;font-family:Arial">' +
    '<table width="680" cellpadding="0" cellspacing="0" align="center" style="max-width:680px;width:100%">' +
    inner +
    '<tr><td style="padding:14px 4px;font-family:Arial;font-size:10px;color:#5b6270">Generado automáticamente · Plataforma Málaga</td></tr>' +
    '</table></div>';
}

function _intro_(texto) {
  return '<tr><td style="padding:14px 16px;background:#0e1118;border:1px solid #1e2430;border-radius:8px;font-family:Arial;font-size:13px;color:#c9ccd3;line-height:1.6">' +
    texto + '</td></tr><tr><td style="height:16px"></td></tr>';
}

/* Tabla de procedencia (origen) a partir del mapa orig {origen:{sop,ped}} */
function _tablaOrigenes_(orig) {
  const keys = Object.keys(orig || {}).sort((x, y) => orig[y].sop - orig[x].sop);
  if (!keys.length) return '';
  const th = 'style="padding:8px 10px;background:#e30613;color:#fff;font-family:Arial;font-size:12px;text-align:center;border:1px solid #b00"';
  const td = 'style="padding:8px 10px;font-family:Arial;font-size:12px;color:#e8eaed;border:1px solid #1e2430;text-align:center"';
  const tdL = 'style="padding:8px 10px;font-family:Arial;font-size:12px;color:#fff;border:1px solid #1e2430;font-weight:bold"';
  const filas = keys.map(o =>
    '<tr><td ' + tdL + '>' + o + '</td><td ' + td + '>' + orig[o].sop + '</td><td ' + td + '>' + orig[o].ped + '</td></tr>'
  ).join('');
  return '<tr><td style="font-family:Arial;font-size:13px;color:#fff;font-weight:bold;padding:0 2px 6px">Procedencia de los retenidos</td></tr>' +
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
    '<th ' + th + '>Origen</th><th ' + th + '>Soportes</th><th ' + th + '>Pedidos</th></tr>' +
    filas + '</table></td></tr><tr><td style="height:16px"></td></tr>';
}

/* Informe GLOBAL (todas las tiendas + plataforma) */
function _emailInformeHTML_(titulo, periodo, agg, prev, unidad) {
  const T = agg.TOTAL, P = prev.TOTAL || {};
  const th = 'style="padding:8px 10px;background:#e30613;color:#fff;font-family:Arial;font-size:12px;text-align:center;border:1px solid #b00"';
  const td = 'style="padding:8px 10px;font-family:Arial;font-size:12px;color:#e8eaed;border:1px solid #1e2430;text-align:center"';
  const tdL = 'style="padding:8px 10px;font-family:Arial;font-size:12px;color:#fff;border:1px solid #1e2430;font-weight:bold"';
  const tdT = 'style="padding:8px 10px;font-family:Arial;font-size:12px;color:#fff;border:1px solid #1e2430;background:#1a1f2b;font-weight:bold;text-align:center"';

  let filas = '';
  TIENDAS_INF.forEach(t => {
    const a = agg[t];
    filas += '<tr><td ' + tdL + '>' + t + '</td>' +
      '<td ' + td + '>' + a.sop + '</td><td ' + td + '>' + a.ped + '</td>' +
      '<td ' + td + '>' + a.lsSop + '</td><td ' + td + '>' + a.ccSop + '</td></tr>';
  });
  filas += '<tr><td style="padding:8px 10px;font-family:Arial;font-size:12px;color:#fff;border:1px solid #1e2430;background:#1a1f2b;font-weight:bold">PLATAFORMA</td>' +
    ['' + T.sop, '' + T.ped, '' + T.lsSop, '' + T.ccSop].map(v => '<td ' + tdT + '>' + v + '</td>').join('') + '</tr>';

  const valor =
    '<tr><td style="padding:14px 16px;background:#0e1118;border:1px solid #1e2430;border-radius:8px;font-family:Arial;font-size:12px;color:#c9ccd3;line-height:1.6">' +
      '<strong style="color:#fff">Valor para las tiendas este ' + unidad + ':</strong><br>' +
      'Hemos retenido y consolidado en la plataforma <strong style="color:#fff">' + T.sop + ' soportes</strong> (' + T.ped + ' pedidos): ' +
      '<strong style="color:#fff">' + T.lsSop + '</strong> de LS-SIE y <strong style="color:#fff">' + T.ccSop + '</strong> de CC. ' +
      'Son bultos que agrupamos para que no lleguen sueltos a tienda: menos recepciones y menos manipulación.' +
    '</td></tr>';

  const tabla =
    '<tr><td style="font-family:Arial;font-size:13px;color:#fff;font-weight:bold;padding:0 2px 6px">Desglose por tienda y flujo</td></tr>' +
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
      '<th ' + th + '>Tienda</th><th ' + th + '>Soportes</th><th ' + th + '>Pedidos</th><th ' + th + '>LS-SIE</th><th ' + th + '>CC</th>' +
    '</tr>' + filas + '</table></td></tr><tr><td style="height:16px"></td></tr>';

  const intro = _intro_(
    'Resumen de los <strong style="color:#fff">soportes y pedidos retenidos y consolidados</strong> en la plataforma de Málaga durante el periodo indicado. ' +
    'Incluye el desglose por <strong style="color:#fff">tienda</strong> (Málaga, Marbella, Mijas), por <strong style="color:#fff">flujo</strong> (LS-SIE / CC) y por <strong style="color:#fff">procedencia</strong>. ' +
    'El objetivo es agrupar mercancía en la plataforma para reducir envíos sueltos y manipulación en tienda.');

  return _wrap_(_cabecera_(titulo, periodo) + intro + _kpis_(T, P, unidad) + tabla + _tablaOrigenes_(T.orig) + valor);
}

/* Informe POR TIENDA (solo sus datos) */
function _emailInformeTiendaHTML_(titulo, periodo, tienda, a, p, unidad) {
  const valor =
    '<tr><td style="padding:14px 16px;background:#0e1118;border:1px solid #1e2430;border-radius:8px;font-family:Arial;font-size:12px;color:#c9ccd3;line-height:1.6">' +
      '<strong style="color:#fff">Valor para ' + tienda + ' este ' + unidad + ':</strong><br>' +
      'Hemos retenido y consolidado para ' + tienda + ' <strong style="color:#fff">' + a.sop + ' soportes</strong> (' + a.ped + ' pedidos): ' +
      '<strong style="color:#fff">' + a.lsSop + '</strong> de LS-SIE y <strong style="color:#fff">' + a.ccSop + '</strong> de CC, ' +
      'agrupados en la plataforma para que no lleguen sueltos a tu tienda.' +
    '</td></tr>';
  const intro = _intro_(
    'Resumen de los <strong style="color:#fff">soportes y pedidos</strong> que hemos retenido y consolidado para <strong style="color:#fff">' + tienda + '</strong> ' +
    'durante el periodo indicado, con el detalle por <strong style="color:#fff">flujo</strong> (LS-SIE / CC) y por <strong style="color:#fff">procedencia</strong>.');
  return _wrap_(_cabecera_(titulo + ' — ' + tienda, periodo) + intro + _kpis_(a, p, unidad) + _tablaOrigenes_(a.orig) + valor);
}

/* ---------------- Lanzar a mano (pruebas) ---------------- */
function informeSemanalMenu() { informeSemanal(); }
function informeMensualMenu() { informeMensual(); }
