/**
 * MECO — PLAT MALAGA -> etiquetas HODOS (origen MECO).
 * HODOS es un proyecto/webapp aparte (C:\Users\30081048\Desktop\Proyectos\hodos,
 * Supabase). Aquí solo se agrupa por tienda y se llama a su webhook — ver
 * docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
 */

// E014/E036/E279 (E043 no aparece en PLAT MALAGA, no se opera en tienda).
const MECO_TIENDA_CANONICA = { 'E014': 'Marbella', 'E036': 'Málaga', 'E279': 'Mijas' };

/**
 * Sube temporalmente el blob .xlsx a Drive convertido a Google Sheets, lee su
 * primera hoja como valores, y BORRA el archivo temporal (éxito o error).
 * Requiere el servicio avanzado Drive v2 (ver appsscript.json).
 */
function _leerXlsxComoValores_(blob) {
  const recurso = { title: 'tmp-meco-' + Utilities.getUuid(), mimeType: MimeType.GOOGLE_SHEETS };
  const archivo = Drive.Files.insert(recurso, blob, { convert: true });
  try {
    const ss = SpreadsheetApp.openById(archivo.id);
    return ss.getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(archivo.id);
  }
}

/**
 * Agrupa las filas del xlsx de PLAT MALAGA (Cod.Tienda|Nom.Tienda|Expedición|
 * CMP|Peso) por tienda canónica Y EXPEDICIÓN — dos entregas a la misma tienda
 * el mismo día llevan expediciones distintas y deben salir como lotes
 * separados (si no, el antiduplicado por expedición de HODOS compararía mal
 * una de las dos). Devuelve un array de
 * { destino: 'Marbella', expedicion: '...', pedidosTexto: '53352497\n53354241' }.
 * Un código de tienda no reconocido se ignora (no rompe el resto).
 */
function _agruparPlatMalagaPorTienda_(filasXlsx) {
  const porClave = {}; // "destino|expedicion" -> { destino, expedicion, cmps: [] }
  const orden = [];
  for (let i = 1; i < filasXlsx.length; i++) { // fila 0 = cabecera
    const codigo = t_(filasXlsx[i][0]);
    const destino = MECO_TIENDA_CANONICA[codigo];
    if (!destino) continue;
    const expedicion = t_(filasXlsx[i][2]);
    const cmp = t_(filasXlsx[i][3]);
    if (cmp === '') continue;
    const clave = destino + '|' + expedicion;
    if (!porClave[clave]) { porClave[clave] = { destino: destino, expedicion: expedicion, cmps: [] }; orden.push(clave); }
    porClave[clave].cmps.push(cmp);
  }
  return orden.map(clave => {
    const g = porClave[clave];
    return { destino: g.destino, expedicion: g.expedicion, pedidosTexto: g.cmps.join('\n') };
  });
}

/**
 * Manda un lote por tienda al webhook de HODOS, origen MECO. Desde el Plan 2
 * reutiliza el envío genérico (ArrastresHodos.gs) — antes tenía su propia
 * llamada a UrlFetchApp duplicada. `grupos` ya trae `expedicion` por grupo
 * (ver _agruparPlatMalagaPorTienda_), así que el antiduplicado del lado HODOS
 * compara cada entrega contra la que le corresponde de verdad.
 * Devuelve { ok: [{destino, idsCreados}], fallidos: [{destino, error}] } o,
 * si faltan las Propiedades/MecoConfig.gs, { ok: [], fallidos: [...] }.
 */
function _enviarLotesMecoAHodos_(grupos) {
  const lineas = grupos.map(g => ({ tienda: g.destino, texto: g.pedidosTexto, origen: 'MECO', expedicion: g.expedicion }));
  // _enviarLineasHodos_ junta por texto con '\n' si dos grupos comparten
  // origen+tienda+expedición; aquí cada grupo YA es único por esa clave, así
  // que el resultado es uno a uno con `grupos`.
  const r = _enviarLineasHodos_(lineas);
  if (r.ok.length === 0 && r.fallidos.length && r.fallidos[0].error && r.fallidos[0].error.indexOf('Faltan') === 0) {
    return { errorConfig: r.fallidos[0].error };
  }
  return {
    ok: r.ok.map(o => ({ destino: o.destino, idsCreados: o.idsCreados })),
    fallidos: r.fallidos.map(f => ({ destino: f.destino, error: f.error }))
  };
}
