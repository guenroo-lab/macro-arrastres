/**
 * ARRASTRES -> HODOS
 * Envío genérico de las líneas que devuelve _generarHodos_ (Hodos.gs) al
 * webhook de la app HODOS (registrarLoteArrastre, ver Plan 1). Reutilizado
 * también por Meco (MecoHodos.gs), que antes tenía su propio envío duplicado.
 *
 * Agrupa por origen+tienda+EXPEDICIÓN, no solo origen+tienda: dos entregas de
 * la misma plataforma a la misma tienda el mismo día son dos expediciones
 * distintas y necesitan lotes separados para que el antiduplicado de HODOS
 * (clave origen+destino+expedicion) compare cada una contra lo que le toca.
 */

/**
 * Agrupa líneas { tienda, texto, origen, expedicion } por origen|tienda|expedicion.
 * Las líneas sin origen (TRAMECO) se excluyen. Devuelve un array de
 * { origen, destino, pedidosTexto, expedicion }, uno por combinación, en el
 * orden en que aparece cada combinación por primera vez.
 */
function _agruparLineasHodosPorLote_(lineas) {
  const porClave = {};
  const orden = [];
  (lineas || []).forEach(l => {
    if (!l.origen) return; // TRAMECO: sin origen, no se manda
    const clave = l.origen + '|' + l.tienda + '|' + (l.expedicion || '');
    if (!porClave[clave]) {
      porClave[clave] = { origen: l.origen, destino: l.tienda, expedicion: l.expedicion || '', textos: [] };
      orden.push(clave);
    }
    porClave[clave].textos.push(l.texto);
  });
  return orden.map(clave => {
    const g = porClave[clave];
    return { origen: g.origen, destino: g.destino, pedidosTexto: g.textos.join('\n'), expedicion: g.expedicion };
  });
}

/**
 * Manda un lote por combinación origen+tienda+expedición al webhook de HODOS.
 * Sigue con los demás lotes aunque uno falle. Devuelve
 * { ok: [{origen, destino, idsCreados, omitidos}], fallidos: [{origen, destino, error}] }.
 * Config leída de MecoConfig.gs (con fallback a Propiedades del script) — mismo
 * mecanismo ya en uso por Meco, ver MecoHodos.gs.
 */
function _enviarLineasHodos_(lineas) {
  const grupos = _agruparLineasHodosPorLote_(lineas);
  if (!grupos.length) return { ok: [], fallidos: [] };

  const token = (typeof MECO_INCPC_SHARED_TOKEN !== 'undefined' && MECO_INCPC_SHARED_TOKEN !== 'PEGA_AQUI_EL_TOKEN')
    ? MECO_INCPC_SHARED_TOKEN : PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
  const url = (typeof MECO_HODOS_WEBAPP_URL !== 'undefined' && MECO_HODOS_WEBAPP_URL)
    ? MECO_HODOS_WEBAPP_URL : PropertiesService.getScriptProperties().getProperty('HODOS_WEBAPP_URL');
  if (!token || !url) {
    return { ok: [], fallidos: grupos.map(g => ({ origen: g.origen, destino: g.destino, error: 'Faltan INCPC_SHARED_TOKEN o HODOS_WEBAPP_URL (revisa MecoConfig.gs).' })) };
  }
  const operario = Session.getActiveUser().getEmail() || 'desconocido';

  const ok = [], fallidos = [];
  grupos.forEach(g => {
    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({
          accion: 'registrarLoteArrastre', token: token, origen: g.origen,
          destino: g.destino, pedidosTexto: g.pedidosTexto, expedicion: g.expedicion, operario: operario
        }),
        muteHttpExceptions: true
      });
      const json = JSON.parse(resp.getContentText());
      if (json.ok) ok.push({ origen: g.origen, destino: g.destino, idsCreados: json.idsCreados || [], omitidos: json.omitidos || [] });
      else fallidos.push({ origen: g.origen, destino: g.destino, error: json.error || 'HODOS devolvió un error sin detalle' });
    } catch (e) {
      fallidos.push({ origen: g.origen, destino: g.destino, error: e.message });
    }
  });
  return { ok: ok, fallidos: fallidos };
}
