/**
 * SUGERENCIAS / MEJORAS / FALLOS  (módulo reutilizable)
 *
 * Botón pequeño para que el personal o los jefes de equipo manden sugerencias,
 * mejoras o fallos de la app, con la opción de adjuntar una foto o un recorte.
 * Se envían por correo a CFG.SUGERENCIAS_PARA.
 *
 * Cómo reutilizarlo en otra app:
 *   1) Copia este archivo (Sugerencias.gs) y SugerenciasForm.html. OJO: en Apps
 *      Script no puede haber dos archivos con el mismo nombre base, por eso el
 *      HTML se llama SugerenciasForm (no Sugerencias).
 *   2) En Config.gs define APP_NOMBRE y SUGERENCIAS_PARA.
 *   3) Llama a abrirSugerencias() desde un botón del panel o del menú.
 *
 * Depende solo de esc_() (escape HTML), que ya está en el proyecto.
 */

/** Abre el formulario de sugerencias (sirve desde el menú y desde el panel). */
function abrirSugerencias() {
  const html = HtmlService.createHtmlOutputFromFile('SugerenciasForm')
    .setWidth(420).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '💡 Sugerencias y mejoras');
}

/**
 * Envía la sugerencia por correo. La llama el formulario con:
 *   { categoria, texto, imagenBase64, imagenNombre, imagenTipo }
 * imagen* son opcionales. Devuelve un mensaje de confirmación.
 */
function enviarSugerencia(payload) {
  payload = payload || {};
  const texto = String(payload.texto == null ? '' : payload.texto).trim();
  if (!texto) throw new Error('Escribe tu sugerencia antes de enviar.');

  const categoria = String(payload.categoria || 'Sugerencia').trim() || 'Sugerencia';
  const para = (CFG.SUGERENCIAS_PARA && CFG.SUGERENCIAS_PARA.length)
    ? CFG.SUGERENCIAS_PARA.join(',')
    : 'pedro.gil@ext.leroymerlin.es';

  const ss = SpreadsheetApp.getActive();
  const app = String(CFG.APP_NOMBRE || ss.getName() || 'App');
  const cuando = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  let usuario = '';
  try { usuario = Session.getActiveUser().getEmail(); } catch (e) {}

  const asunto = '[' + categoria + ' · ' + app + ']' + (usuario ? ' ' + usuario : '');
  const opciones = {
    htmlBody: _sugerenciaHtml_(app, categoria, texto, usuario, cuando),
    name: 'Sugerencias ' + app
  };
  if (usuario) opciones.replyTo = usuario; // así puedes responder directo a quien la manda

  // Imagen opcional (base64 del navegador) -> adjunto
  if (payload.imagenBase64) {
    try {
      const bytes = Utilities.base64Decode(payload.imagenBase64);
      const blob = Utilities.newBlob(bytes, payload.imagenTipo || 'image/png',
        payload.imagenNombre || 'captura.png');
      opciones.attachments = [blob];
    } catch (e) { /* si la imagen falla, se envía igual el texto */ }
  }

  MailApp.sendEmail(para, asunto, _sugerenciaTexto_(app, categoria, texto, usuario, cuando), opciones);
  return '¡Gracias! Tu ' + categoria.toLowerCase() + ' se ha enviado.';
}

/* ---------------- Cuerpo del correo ---------------- */
function _sugerenciaHtml_(app, categoria, texto, usuario, cuando) {
  const color = categoria.toLowerCase() === 'fallo' ? '#e30613'
    : (categoria.toLowerCase() === 'mejora' ? '#f0a500' : '#00b050');
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden">' +
      '<div style="background:#11141c;padding:16px 20px">' +
        '<div style="color:#fff;font-size:17px;font-weight:bold">💡 ' + esc_(categoria) + ' · ' + esc_(app) + '</div>' +
        '<div style="color:' + color + ';font-size:12px;font-weight:bold;margin-top:2px">Sugerencias y mejoras</div>' +
      '</div>' +
      '<div style="padding:18px 20px;color:#222;font-size:14px">' +
        '<p style="white-space:pre-wrap;margin:0 0 16px;line-height:1.5">' + esc_(texto) + '</p>' +
        '<table style="border-collapse:collapse;font-size:13px;color:#444">' +
          '<tr><td style="padding:4px 10px 4px 0;color:#888">Enviada por</td><td style="padding:4px 0">' + esc_(usuario || '(desconocido)') + '</td></tr>' +
          '<tr><td style="padding:4px 10px 4px 0;color:#888">Fecha</td><td style="padding:4px 0">' + esc_(cuando) + '</td></tr>' +
          '<tr><td style="padding:4px 10px 4px 0;color:#888">App</td><td style="padding:4px 0">' + esc_(app) + '</td></tr>' +
        '</table>' +
        '<p style="margin:16px 0 0;color:#888;font-size:11px">Mensaje del botón de sugerencias. Responde a este correo para contestar a quien lo envió.</p>' +
      '</div>' +
    '</div>';
}

function _sugerenciaTexto_(app, categoria, texto, usuario, cuando) {
  return [
    categoria + ' · ' + app,
    '',
    texto,
    '',
    'Enviada por: ' + (usuario || '(desconocido)'),
    'Fecha: ' + cuando
  ].join('\n');
}
