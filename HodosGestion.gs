/**
 * GESTIÓN DE ETIQUETAS DE ARRASTRES EN HODOS (desde la web, 2026-09-10)
 * Llama al MISMO webhook que ya usa el envío de etiquetas (ArrastresHodos.gs),
 * con 4 acciones nuevas del lado de HODOS: listar pendientes, HTML de
 * impresión, marcar impresas, borrar. Mismo mecanismo de autenticación
 * (token compartido + Bearer OAuth) — google.script.run no puede llamar de un
 * proyecto de Apps Script a otro, así que esto siempre pasa por HTTP.
 *
 * Orígenes válidos: los mismos 4 grupos "ARRASTRES" de la barra lateral de
 * HODOS (Meco, Valencia, Torija, Antequera) — HODOS valida el origen otra vez
 * por su cuenta (_validarOrigenArrastre_), esto es solo para la lista de la web.
 */
const HODOS_ORIGENES_ARRASTRE = ['Meco', 'Valencia', 'Torija', 'Antequera'];

function _hodosWebhookConfig_() {
  const token = (typeof MECO_INCPC_SHARED_TOKEN !== 'undefined' && MECO_INCPC_SHARED_TOKEN !== 'PEGA_AQUI_EL_TOKEN')
    ? MECO_INCPC_SHARED_TOKEN : PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
  const url = (typeof MECO_HODOS_WEBAPP_URL !== 'undefined' && MECO_HODOS_WEBAPP_URL)
    ? MECO_HODOS_WEBAPP_URL : PropertiesService.getScriptProperties().getProperty('HODOS_WEBAPP_URL');
  if (!token || !url) throw new Error('Faltan INCPC_SHARED_TOKEN o HODOS_WEBAPP_URL (revisa MecoConfig.gs).');
  return { token: token, url: url };
}

/** POST genérico al webhook de HODOS. Lanza si HODOS responde ok:false o si la petición falla. */
function _hodosWebhookLlamar_(accion, extra) {
  const cfg = _hodosWebhookConfig_();
  const payload = Object.assign({ accion: accion, token: cfg.token }, extra || {});
  const resp = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (!json.ok) throw new Error(json.error || 'HODOS devolvió un error sin detalle');
  return json;
}

/** Lista las etiquetas de arrastre pendientes de imprimir de un origen. */
function listarEtiquetasHodos(origen) {
  return _hodosWebhookLlamar_('listarPendientesArrastre', { origen: origen }).etiquetas || [];
}

/** HTML de impresión (etiquetas Zebra, ya montado por HODOS) de un origen. */
function htmlImprimirEtiquetasHodos(origen) {
  return { html: _hodosWebhookLlamar_('htmlPendientesArrastre', { origen: origen }).html };
}

/** Marca impresas TODAS las pendientes de un origen. Devuelve { cantidad }. */
function marcarImpresasEtiquetasHodos(origen) {
  return _hodosWebhookLlamar_('marcarImpresasArrastre', { origen: origen }).resultado || { cantidad: 0 };
}

/** Borra las etiquetas seleccionadas (por idUnico). Devuelve { borrados, rechazados }. */
function borrarEtiquetasHodos(idsUnicos) {
  if (!idsUnicos || !idsUnicos.length) throw new Error('No hay etiquetas seleccionadas.');
  return _hodosWebhookLlamar_('borrarEtiquetasArrastre', { idsUnicos: idsUnicos }).resultado || { borrados: [], rechazados: [] };
}
