/**
 * ANTEQUERA · PDF → hoja TOP (formato arrastre) + expansión con TOM
 *
 * Antequera no llega como Excel (como Valencia/Torija), sino como PDF de texto.
 * El más útil es el "Detalle de los contenidos entregados", que por cada soporte trae el
 * PEDIDO (Pegase) y, en CC, el Pyxis tras la "/". El diálogo (AntequeraForm.html) lo lee
 * con pdf.js (sin OCR) y manda aquí las líneas con: pedido, pyxis, flujo, soporte, tienda, exp.
 *
 * IMPORTANTE — los dos PDF de Antequera NO comparten clave de soporte: el "Resumen de
 * albaranes" (artículo/EAN, por palé) no engancha con el "Detalle" (bulto/jaula). Por eso
 * el LM/EAN NO salen del Resumen, sino que:
 *   - El LM (referencia) y las unidades salen de la hoja TOM (Pedidos Vivos), cruzando el
 *     PEDIDO (Pegase) contra "Nº pedido proveedor" (col M, índice 12). Cada pedido se
 *     EXPANDE a una fila por referencia.
 *   - El Pyxis (Nº Pedido cliente, col A) se completa desde TOM si el PDF no lo trae.
 *   - El EAN lo rellena luego procesarArrastres() desde la hoja EAN a partir del LM.
 *
 * Columnas TOP que rellena (0-based, las mismas que lee Proceso_Arrastres.gs):
 *   A(0)=Origen "Antequera" · B(1)=Expedición · G(6)=Tienda · J(9)=Pedido(Pegase) · K(10)=Pyxis(cliente)
 *   L(11)=Flujo · M(12)=Agrupación(vacío) · Q(16)=SSCC(soporte) · S(18)=LM(referencia) · W(22)=Unidades
 */

/**
 * ⚠️ VERSIÓN ANTIGUA (Detalle + TOM). La que usa Panel Arrastres desde 2026-10-05 es
 * la v2: AntequeraPlan.gs (análisis desde el RESUMEN, con vista previa) +
 * volcarAntequeraLineasTOP (más abajo). Esta antigua solo sigue viva para el diálogo del
 * menú del Sheet (AntequeraForm.html) y PIERDE los palés preparados en Antequera (los que
 * no traen Pegase en el Detalle) — no la uses para trabajo real; usa el Panel Arrastres.
 */

/** Abre el diálogo de Antequera (sirve desde el menú y desde el panel). */
function abrirAntequera() {
  const html = HtmlService.createHtmlOutputFromFile('AntequeraForm')
    .setWidth(760).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Antequera · PDF → TOP');
}

/**
 * Lee TOM (desde Drive, ver TOMDrive.gs) agrupado por "Nº pedido proveedor" (Pegase):
 *   byProv[pegase] = { cliente, transporte, lineas: [{ref, cant, desc}] }
 * Las líneas de tipo "Servicio" se excluyen (no son artículos físicos).
 * Columnas localizadas por CABECERA (_indicesTOM_), no por posición fija.
 */
function _tomLinesAntequera_() {
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { byProv: {}, filas: 0, error: tomDatos.error };
  const vals = tomDatos.filas;
  const iTOM = tomDatos.iTOM;
  const last = vals.length;
  if (last < 2) return { byProv: {}, filas: 0 };
  const byProv = {};
  for (let i = 1; i < last; i++) {                 // fila 1 = cabecera
    const prov = t_(vals[i][iTOM.pegase]);
    if (prov === '') continue;
    if (!byProv[prov]) byProv[prov] = { cliente: t_(vals[i][iTOM.pyxis]), transporte: t_(vals[i][iTOM.transporte]), lineas: [] };
    if (t_(vals[i][iTOM.tipoLinea]).toUpperCase().indexOf('SERVICIO') !== -1) continue; // sin servicios
    const ref = t_(vals[i][iTOM.referencia]);      // LM
    if (ref !== '') byProv[prov].lineas.push({
      ref: ref, cant: t_(vals[i][iTOM.cantidad]),
      desc: t_(vals[i][iTOM.descReferencia])        // -> Articulo
    });
  }
  return { byProv: byProv, filas: last - 1 };
}

/**
 * Vuelca en la hoja TOP las líneas del Detalle, agrupadas por pedido y EXPANDIDAS con las
 * referencias (LM) de TOM. filas: array { origen, exp, tienda, pedido, pyxis, flujo, soporte }.
 * NO procesa: después el usuario pulsa "Procesar arrastres" (que rellenará el EAN).
 */
function volcarAntequeraTOP(filas, mapaResumen) {
  if (!filas || !filas.length) throw new Error('No hay filas que volcar. Revisa los PDF en el diálogo.');
  mapaResumen = mapaResumen || {};   // { referencia: Soporte } del Resumen de albaranes

  const tom = _tomLinesAntequera_();
  if (tom.error) throw new Error(tom.error);

  // --- 1. Agrupar el Detalle por pedido (Pegase) ---
  const peds = {}, orden = [];
  let descartadas = 0;   // contenidos sin Pegase (palés preparados en Antequera): esta versión antigua no los vuelca
  filas.forEach(f => {
    const ped = t_((f || {}).pedido);
    if (ped === '') { descartadas++; return; }
    if (!peds[ped]) {
      peds[ped] = { pedido: ped, pyxis: t_(f.pyxis), flujo: t_(f.flujo),
        soporte: t_(f.soporte), exp: t_(f.exp), tienda: t_(f.tienda) };
      orden.push(ped);
    } else {
      const p = peds[ped];
      if (!p.pyxis && t_(f.pyxis)) p.pyxis = t_(f.pyxis);
      if (!p.flujo && t_(f.flujo)) p.flujo = t_(f.flujo);
      if (!p.soporte && t_(f.soporte)) p.soporte = t_(f.soporte);
    }
  });

  // --- 2. Expandir a artículo con el LM de TOM ---
  const out = [];
  let cruzados = 0, sinTom = 0, recCliente = 0, lmGen = 0;
  orden.forEach(ped => {
    const p = peds[ped];
    const info = tom.byProv[ped];
    let pyx = p.pyxis;
    if (info && !pyx && info.cliente) { pyx = info.cliente; recCliente++; }
    const base = { origen: 'Antequera', exp: p.exp, tienda: p.tienda, pedido: ped,
      pyxis: pyx, flujo: p.flujo, contenido: p.soporte, ean: '' };  // contenido = bulto del Detalle
    if (info && info.lineas.length) {
      cruzados++;
      info.lineas.forEach(ln => {
        out.push(Object.assign({}, base, {
          lm: ln.ref, unidades: ln.cant, desc: ln.desc || '',
          soporte: t_(mapaResumen[ln.ref])           // Soporte del Resumen, casado por referencia
        }));
        lmGen++;
      });
    } else {
      if (!info) sinTom++;
      out.push(Object.assign({}, base, { lm: '', unidades: '', desc: '', soporte: '' })); // no perder el pedido
    }
  });

  // --- 3. Construir matriz TOP ---
  const ANCHO = 23; // A..W
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  if (!wsTOP) throw new Error('No existe la hoja "' + CFG.HOJAS.TOP + '".');

  const cab = new Array(ANCHO).fill('');
  cab[0] = 'Origen'; cab[1] = 'Exp'; cab[6] = 'Tienda'; cab[9] = 'Pedido'; cab[10] = 'Pyxis';
  cab[11] = 'Flujo'; cab[12] = 'Agrupación'; cab[15] = 'Soporte'; cab[16] = 'Contenido';
  cab[18] = 'LM'; cab[19] = 'EAN'; cab[20] = 'Articulo'; cab[22] = 'Unidades';

  const matriz = [cab];
  out.forEach(o => {
    const fila = new Array(ANCHO).fill('');
    fila[0]  = t_(o.origen) || 'Antequera';
    fila[1]  = t_(o.exp);
    fila[6]  = t_(o.tienda);
    fila[9]  = t_(o.pedido);
    fila[10] = t_(o.pyxis);
    fila[11] = t_(o.flujo);
    // M (12) agrupación -> vacío (la regla LS-SIE exige M vacío)
    fila[15] = t_(o.soporte);                      // P = Soporte (del Resumen de albaranes)
    fila[16] = t_(o.contenido);                    // Q = Contenido (bulto del Detalle)
    fila[18] = t_(o.lm);                           // S = LM (referencia de TOM)
    fila[19] = t_(o.ean);                          // T = EAN (lo rellena procesarArrastres desde la hoja EAN)
    fila[20] = t_(o.desc);                         // U = Articulo (Desc. Referencia de TOM, col I)
    fila[22] = t_(o.unidades);                     // W = Unidades
    matriz.push(fila);
  });

  // --- 4. Limpiar TOP y escribir (todo TEXTO para no perder dígitos) ---
  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();

  const rango = wsTOP.getRange(1, 1, matriz.length, ANCHO);
  rango.setNumberFormat('@');
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, ANCHO).setFontWeight('bold');
  autoajustar_(wsTOP, 1, ANCHO);

  // --- 5. Resumen ---
  const nPed = orden.length;
  let msg = 'Antequera OK · ' + nPed + ' pedidos · ' + out.length + ' líneas en TOP · ' +
    cruzados + ' cruzados con TOM (' + lmGen + ' LM, ' + recCliente + ' pedidos cliente recuperados)' +
    (sinTom ? ' · ' + sinTom + ' pedidos SIN match en TOM' : '') + '. Ahora pulsa "Procesar arrastres".';
  if (tom.filas === 0) {
    msg = '⚠️ La hoja TOM está vacía: no se pudo sacar LM ni pedido cliente. Carga "Pedidos Vivos" en TOM y vuelve a generar. · ' + msg;
  }
  if (descartadas) {
    msg = '⚠️ ' + descartadas + ' palé(s) preparados en Antequera NO se han volcado (versión antigua). Usa el Panel Arrastres: ahí sí entran. · ' + msg;
  }
  ss.toast(msg, '📦 Antequera', 12);
  return msg;
}

/**
 * ANTEQUERA v2 · vuelca en TOP las líneas del análisis (AntequeraPlan.gs): UNA FILA POR
 * LÍNEA DEL RESUMEN, con el soporte real del palé. NO procesa: después se llama a
 * procesarArrastresWeb (marca VERDE por Pyxis con transporte, registra retenidos y genera
 * las etiquetas HODOS de Antequera).
 *
 * Columnas TOP (0-based, las mismas que lee Proceso_Arrastres.gs):
 *   A(0)=Origen · B(1)=Expedición · G(6)=Tienda · J(9)=Pedido (Pegase; si no se conoce, el
 *   Pyxis — J nunca puede ir vacía: ultimaFilaCol_ la usa para saber dónde acaba TOP) ·
 *   K(10)=Pyxis · L(11)=Flujo · P(15) y Q(16)=Soporte (Q es el "SSCC" que se registra en
 *   RETENIDOS: aquí el soporte del Resumen, el que lleva la etiqueta del palé) ·
 *   S(18)=LM tal cual viene en el PDF (los códigos "48…" con sufijo los recorta el paso 0 de
 *   procesarArrastres; si se recortaran aquí se recortarían dos veces) · U(20)=Artículo ·
 *   W(22)=Unidades. La EAN (T) la rellena procesarArrastres.
 */
function volcarAntequeraLineasTOP(lineas) {
  if (!lineas || !lineas.length) throw new Error('No hay líneas que volcar. Sube los PDF y revisa la vista previa.');
  const malas = lineas.filter(l => !/^\d{5,}$/.test(t_((l || {}).soporte)));
  if (malas.length) throw new Error('Hay ' + malas.length + ' línea(s) sin soporte. Vuelve a subir los PDF.');

  const ANCHO = 23; // A..W
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  if (!wsTOP) throw new Error('No existe la hoja "' + CFG.HOJAS.TOP + '".');

  const cab = new Array(ANCHO).fill('');
  cab[0] = 'Origen'; cab[1] = 'Exp'; cab[6] = 'Tienda'; cab[9] = 'Pedido'; cab[10] = 'Pyxis';
  cab[11] = 'Flujo'; cab[12] = 'Agrupación'; cab[15] = 'Soporte'; cab[16] = 'SSCC';
  cab[18] = 'LM'; cab[19] = 'EAN'; cab[20] = 'Articulo'; cab[22] = 'Unidades';

  const matriz = [cab];
  let sinPedido = 0;
  const palets = {};
  lineas.forEach(l => {
    const fila = new Array(ANCHO).fill('');
    fila[0]  = 'Antequera';
    fila[1]  = t_(l.exp);
    fila[6]  = t_(l.tienda);
    fila[9]  = t_(l.pegase) || t_(l.pyxis) || 'SIN PEDIDO';
    fila[10] = t_(l.pyxis);
    fila[11] = t_(l.flujo) || 'CC';
    // M (12) agrupación -> vacío (la regla LS-SIE exige M vacío)
    fila[15] = t_(l.soporte);
    fila[16] = t_(l.soporte);
    fila[18] = t_(l.lmRaw);
    fila[20] = t_(l.desc);
    fila[22] = l.uds == null ? '' : t_(l.uds);
    if (fila[10] === '') sinPedido++;
    palets[fila[15]] = true;
    matriz.push(fila);
  });

  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();
  const rango = wsTOP.getRange(1, 1, matriz.length, ANCHO);
  rango.setNumberFormat('@');                    // todo texto: no perder dígitos
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, ANCHO).setFontWeight('bold');
  autoajustar_(wsTOP, 1, ANCHO);

  const msg = 'Antequera OK · ' + Object.keys(palets).length + ' palés · ' + lineas.length + ' líneas en TOP' +
    (sinPedido ? ' · ⚠️ ' + sinPedido + ' línea(s) SIN pedido (REVISAR)' : '') + '.';
  ss.toast(msg, '📦 Antequera', 8);
  return msg;
}
