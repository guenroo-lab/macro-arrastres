/**
 * ENVÍO DE RETENIDOS POR CORREO
 * Un envío por tienda. Manda solo las líneas pendientes (Enviado vacío) y las
 * sella como "Enviado dd/mm/aaaa hh:mm" — NO las borra (eso lo hace la limpia
 * de las 3:00). Si hay líneas sin Expedición, avisa antes de enviar.
 *
 * Remitente: CFG.REMITENTE (alias "Enviar como"). Si no está disponible, sale
 * desde tu cuenta y se informa en el resultado.
 * Copia fija: CFG.CC_FIJO.  Destinatarios por tienda: CFG.TIENDAS_ENVIO.
 */

/**
 * Envía los retenidos pendientes de una tienda.
 * forzar = true para enviar aunque falten Expediciones.
 * Devuelve un objeto de estado para el panel:
 *   { estado:'sin_pendientes' }
 *   { estado:'falta_expedicion', sinExp, total }
 *   { estado:'enviado', enviados, sinExp, remitente }
 */
function enviarRetenidosTienda(tienda, forzar) {
  const destinos = CFG.TIENDAS_ENVIO[tienda];
  if (!destinos) throw new Error('Tienda sin envío configurado: ' + tienda);
  const bloque = _bloquePorNombre_(tienda);
  if (!bloque) throw new Error('Tienda no válida: ' + tienda);

  const ws = hojaRetenidos_();
  const ancho = CFG.RETEN_COLS.length;
  const last = ws.getLastRow();
  if (last < 3) return { estado: 'sin_pendientes' };

  const col = _colDeBloque_(ws, tienda);
  const rng = ws.getRange(3, col, last - 2, ancho);
  const datos = rng.getValues();

  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');

  // columnas: 0 Tipo,1 Flete,2 Pedido,3 Pyxis,4 Agrup,5 SSCC,6 Exped,7 Enviado,8 Día
  // Pendiente = con pedido, NO enviado y con Día == HOY (lo de mañana espera).
  const pend = [];
  let sinExp = 0, pendOtroDia = 0;
  datos.forEach((r, i) => {
    if (t_(r[2]) !== '' && t_(r[7]) === '') {
      if (t_(r[8]) !== '' && t_(r[8]) !== hoy) { pendOtroDia++; return; }
      pend.push(i);
      if (t_(r[6]) === '') sinExp++;
    }
  });

  if (!pend.length) return { estado: 'sin_pendientes', otroDia: pendOtroDia };
  if (sinExp > 0 && !forzar) return { estado: 'falta_expedicion', sinExp: sinExp, total: pend.length };

  // Cuerpo del correo
  const filasHtml = pend.map((i, k) => {
    const r = datos[i];
    const bg = (k % 2) ? '#f6f7f9' : '#ffffff';
    const td = 'style="padding:7px 10px;border:1px solid #e3e3e3"';
    return '<tr style="background:' + bg + '">' +
      '<td ' + td + '>' + esc_(r[0]) + '</td>' +
      '<td ' + td + '>' + esc_(r[1]) + '</td>' +
      '<td ' + td + '>' + esc_(r[2]) + '</td>' +
      '<td ' + td + '>' + esc_(r[3]) + '</td>' +
      '<td ' + td + '>' + esc_(r[4]) + '</td>' +
      '<td ' + td + '>' + esc_(r[5]) + '</td>' +
      '<td ' + td + '><strong>' + esc_(r[6]) + '</strong></td>' +
      '</tr>';
  }).join('');

  const html = _emailRetenidosHtml_(tienda, filasHtml, pend.length);
  const texto = _emailRetenidosTexto_(tienda, datos, pend);
  const asunto = 'Pedidos retenidos ' + tienda + ' \u00b7 ' + _hoy_();

  const remitente = enviarCorreo_(destinos.join(','), asunto, html, texto);

  // Sellar como enviado y reescribir solo el bloque
  const sello = 'Enviado ' + _ahora_();
  pend.forEach(i => { datos[i][7] = sello; });
  rng.setNumberFormat('@');
  rng.setValues(datos);

  // Guardar en el histórico (para informes semanales/mensuales)
  try { _guardarHistorico_(tienda, datos, pend); } catch (e) {}

  return { estado: 'enviado', enviados: pend.length, sinExp: sinExp, remitente: remitente };
}

/* ---- Envíos desde el menú (con confirmación si faltan Expediciones) ---- */
function _enviarMenu_(tienda) {
  const ui = SpreadsheetApp.getUi();
  let r = enviarRetenidosTienda(tienda, false);
  if (r.estado === 'sin_pendientes') {
    ui.alert('Envío ' + tienda, 'No hay pedidos pendientes de enviar.', ui.ButtonSet.OK);
    return;
  }
  if (r.estado === 'falta_expedicion') {
    const ok = ui.alert('Envío ' + tienda,
      'Hay ' + r.sinExp + ' de ' + r.total + ' líneas SIN Expedición.\n¿Enviar igualmente?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    r = enviarRetenidosTienda(tienda, true);
  }
  if (r.estado === 'enviado') {
    SpreadsheetApp.getActive().toast(
      r.enviados + ' líneas enviadas a ' + tienda + ' · remitente: ' + r.remitente,
      '📧 Enviado', 6);
  }
}
function enviarMalagaMenu()   { _enviarMenu_('Málaga'); }
function enviarMarbellaMenu() { _enviarMenu_('Marbella'); }
function enviarMijasMenu()    { _enviarMenu_('Mijas'); }

/* ---- Utilidades de correo ---- */

/**
 * Envía con MailApp. Intenta usar el alias CFG.REMITENTE; si no está dado de
 * alta como "Enviar como", reintenta desde la cuenta actual. Devuelve el
 * remitente realmente usado.
 */
function enviarCorreo_(to, asunto, html, texto, ccExtra) {
  const ccBase = CFG.CC_FIJO.join(',');
  const cc = ccExtra ? (ccBase ? ccBase + ',' + ccExtra : ccExtra) : ccBase;
  const base = { htmlBody: html, cc: cc, name: CFG.REMITENTE_NOMBRE };
  try {
    const o = { htmlBody: html, cc: cc, name: CFG.REMITENTE_NOMBRE, from: CFG.REMITENTE };
    MailApp.sendEmail(to, asunto, texto, o);
    return CFG.REMITENTE;
  } catch (e) {
    MailApp.sendEmail(to, asunto, texto, base);
    let yo = '';
    try { yo = Session.getActiveUser().getEmail(); } catch (e2) {}
    return yo || 'tu cuenta';
  }
}

function _emailRetenidosHtml_(tienda, filasHtml, n) {
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden">' +
      '<div style="background:#11141c;padding:18px 22px">' +
        '<div style="color:#fff;font-size:18px;font-weight:bold;letter-spacing:.5px">Pedidos retenidos \u00b7 ' + esc_(tienda) + '</div>' +
        '<div style="color:#e30613;font-size:13px;font-weight:bold;margin-top:2px">TAISA \u00b7 Leroy Merlin Málaga</div>' +
      '</div>' +
      '<div style="padding:20px 22px;color:#222;font-size:14px">' +
        '<p style="margin:0 0 14px">Buenos días,</p>' +
        '<p style="margin:0 0 16px">Estos son los pedidos retenidos hoy en la plataforma de Málaga (' +
          n + ' línea' + (n === 1 ? '' : 's') + '). Por favor, proceded a su valoración:</p>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
          '<thead><tr style="background:#e30613;color:#fff">' +
            _th_('Tipo') + _th_('Flete') + _th_('Pedido') + _th_('Pyxis') + _th_('Agrupación') + _th_('SSCC') + _th_('Expedición') +
          '</tr></thead>' +
          '<tbody>' + filasHtml + '</tbody>' +
        '</table>' +
        '<p style="margin:16px 0 0;color:#555;font-size:12px">Mensaje automático del sistema de retenidos. Para cualquier incidencia, responder a este correo.</p>' +
      '</div>' +
    '</div>';
}
function _th_(t) { return '<th style="padding:8px 10px;text-align:left;border:1px solid #c9050f">' + t + '</th>'; }

function _emailRetenidosTexto_(tienda, datos, pend) {
  const l = ['Pedidos retenidos ' + tienda + ' - ' + _hoy_(), '',
    'Estos son los pedidos retenidos hoy en la plataforma de Málaga. Por favor, proceded a su valoración:', ''];
  pend.forEach(i => {
    const r = datos[i];
    l.push('Flete ' + t_(r[1]) + ' | Pedido ' + t_(r[2]) + ' | Pyxis ' + t_(r[3]) + ' | Agrup ' + t_(r[4]) +
           ' | SSCC ' + t_(r[5]) + ' | Expedición ' + t_(r[6]));
  });
  l.push('', 'TAISA - Leroy Merlin Málaga');
  return l.join('\n');
}

function esc_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _hoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
}
function _ahora_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}
