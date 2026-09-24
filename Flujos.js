/**
 * FLUJOS — OBSOLETO (Generix / FLUJOSTRA)
 *
 * El antiguo flujo TRAMECO -> FLUJOSTRA (que escribía el pedido con una "M"
 * delante para Generix) ya NO se usa: esos pedidos salen ahora en la hoja
 * HODOS con el número limpio, sin prefijo, junto con los de cerámica.
 * Ver Hodos.gs (`_pedidosTrameco_`).
 *
 * La hoja TRAMECO se sigue usando como ENTRADA (se pegan ahí los datos);
 * lo que desaparece es la salida a FLUJOSTRA.
 *
 * Se deja esta función por si algún acceso directo antiguo la invoca: avisa y
 * no hace nada, en vez de fallar con "función no encontrada".
 */
function copiarFlujosConsolidado() {
  const msg = 'Generix/FLUJOSTRA ya no se usa: esos pedidos salen ahora en la hoja HODOS ' +
    '(sin la "M" delante) al procesar arrastres.';
  SpreadsheetApp.getActive().toast(msg, '🚚 Flujos (obsoleto)', 8);
  return msg;
}
