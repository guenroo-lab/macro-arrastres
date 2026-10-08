/**
 * PROCESO ARRASTRES  (Módulo 1 + Módulo 4 combinados y optimizados)
 * 1) Cruza TOP + TOM + EAN y marca las líneas con transporte como VERDE.
 * 2) Marca las líneas LS válidas como LS-SIE (morado) y las sube arriba.
 * 3) Registra automáticamente los retenidos en la hoja RETENIDOS (acumulando).
 *
 * Optimización: una sola lectura y una sola escritura de TOP, todo el formato
 * por bloques (sin tocar celda a celda) y los retenidos se sacan de memoria
 * (ya no hace falta releer colores).
 */
/**
 * Normaliza un SSCC a entero sin decimales ni separadores.
 * - Quita una parte decimal final (".0", ",00") sin tocar los grupos de miles.
 * - Quita separadores de miles (. o ,).
 * - Intenta expandir notación científica.
 */
function _ssccLimpio_(v) {
  let s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  if (/[eE]/.test(s)) {                      // notación científica -> expandir
    const n = Number(s.replace(',', '.'));
    if (isFinite(n)) s = n.toFixed(0);
  }
  const puntos = (s.match(/\./g) || []).length;
  const comas = (s.match(/,/g) || []).length;
  if (puntos === 1 && comas === 0 && /\.\d{1,2}$/.test(s)) s = s.replace(/\.\d+$/, ''); // decimal ".0"/".00"
  else if (comas === 1 && puntos === 0 && /,\d{1,2}$/.test(s)) s = s.replace(/,\d+$/, '');
  return s.replace(/\D/g, '');               // fuera cualquier separador restante
}

/**
 * Candado de TOP: si dos procesos (menú, panel, web, dos personas a la vez…)
 * intentan calcular y reescribir TOP al mismo tiempo, el segundo puede leer
 * datos a medio escribir del primero. Se envuelve SOLO aquí (el punto único
 * por el que pasan todos los caminos: menú, Panel.html y la web) para no
 * anidar candados si algún día un wrapper externo también intentara uno.
 */
function _procesarArrastresNucleo_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { error: 'Hay otro proceso en marcha, espera unos segundos.' };
  }
  try {
    return _procesarArrastresNucleoCalculo_();
  } finally {
    lock.releaseLock();
  }
}

function _procesarArrastresNucleoCalculo_() {
  // Cronómetro: los tiempos van al registro de ejecución (Apps Script ->
  // "Ejecuciones"). Sirve para ver qué paso se lleva el tiempo de verdad.
  const _t0 = new Date().getTime();
  let _tPrev = _t0;
  const _crono = [];
  const _marca = (etiqueta) => {
    const ahora = new Date().getTime();
    _crono.push(etiqueta + ': ' + (ahora - _tPrev) + ' ms');
    _tPrev = ahora;
  };

  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const wsEAN = ss.getSheetByName(CFG.HOJAS.EAN);
  const wsFAM = ss.getSheetByName(CFG.HOJAS.FAMILIAS);

  const uTOP = ultimaFilaCol_(wsTOP, 10); // J
  if (uTOP < 2) return { error: 'La hoja TOP no tiene datos.' };

  // TOM ya no es una hoja: se lee directo desde Drive (ver TOMDrive.gs). Las
  // columnas se localizan por CABECERA, no por posición fija, así aguanta
  // que Leroy Merlin reordene el export sin tocar código.
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
  const tom = tomDatos.filas;
  const uTOM = tom.length;
  const iTOM = tomDatos.iTOM;
  _marca('leer TOM desde Drive (' + (uTOM - 1) + ' filas)');

  const N = Math.max(wsTOP.getLastColumn(), 26);
  const top = wsTOP.getRange(1, 1, uTOP, N).getValues();
  _marca('lectura TOP(' + uTOP + 'x' + N + ')');

  // Índices 0-based
  const cA = 0, cB = 1, cG = 6, cJ = 9, cK = 10, cL = 11, cM = 12, cP = 15, cQ = 16, cS = 18, cT = 19, cU = 20, cV = 21, cW = 22, cZ = 25;

  // SSCC (col Q) SIEMPRE como texto y solo dígitos. Se lee el valor mostrado y se
  // limpia con _ssccLimpio_ (quita decimales ".0", separadores de miles y notación
  // científica). Esto evita además que el dedup junte SSCC distintos que se
  // redondeaban al mismo número (se perdían filas).
  const ssccDisp = wsTOP.getRange(1, cQ + 1, uTOP, 1).getDisplayValues();
  for (let i = 1; i < uTOP; i++) {
    top[i][cQ] = _ssccLimpio_(ssccDisp[i][0]);
  }

  // --- 0. Recorte de códigos "48" en columna S ---
  for (let i = 1; i < uTOP; i++) {
    const v = t_(top[i][cS]);
    if (v.substring(0, 2) === '48' && v.length > 3) top[i][cS] = v.substring(0, v.length - 3);
  }

  // --- 1. Diccionario TOM (clave = Nº pedido proveedor / Pegase) ---
  const dictTOM = {};
  for (let i = 1; i < uTOM; i++) {
    const id = t_(tom[i][iTOM.pegase]);
    if (id !== '' && !(id in dictTOM)) dictTOM[id] = i;
  }

  // Transporte por PYXIS (TOM). Lo usa Antequera: se retiene el PEDIDO con transporte, y
  // un Pegase de palé de tránsito puede agrupar varios pedidos de cliente (dictTOM guarda
  // solo la primera fila de cada Pegase), así que ahí la clave no puede ser el Pegase.
  const transportePyxis = _transportePorPyxis_(tom, uTOM, iTOM.pyxis, iTOM.transporte);

  // estado[i]: 'VERDE' | 'MORADO' | ''
  const estado = new Array(uTOP).fill('');

  // --- 2. Marcar VERDE y reparar K / S ---
  for (let i = 1; i < uTOP; i++) {
    const vJ = t_(top[i][cJ]);
    const vK = t_(top[i][cK]);
    const llave = vJ.substring(0, 2) === '99' ? vK : vJ;
    const flujoUp = t_(top[i][cL]).toUpperCase();

    // CC2 nunca es VERDE: siempre va a tienda sin retener y siempre necesita
    // etiqueta HODOS, aunque su clave coincida por casualidad con un "SI" de
    // transporte en TOM (eso solo aplica al flujo normal, no a CC2).
    // Antequera (2026-10-05): VERDE = el PYXIS de la línea tiene transporte en TOM.
    let esVerde = false;
    if (flujoUp === 'CCM') esVerde = true;
    else if (t_(top[i][cA]) === 'Antequera') {
      if (flujoUp !== 'CC2' && vK !== '' && transportePyxis[vK] === 'SI') esVerde = true;
    }
    else if (flujoUp !== 'CC2' && llave in dictTOM && t_(tom[dictTOM[llave]][iTOM.transporte]).toUpperCase() === 'SI') esVerde = true;

    if (esVerde) {
      estado[i] = 'VERDE';
      if (vK === '' && (llave in dictTOM)) top[i][cK] = tom[dictTOM[llave]][iTOM.pyxis];  // K <- TOM Pyxis
      // T sobreescribe S (en Valencia/Torija T trae el LM real). En Antequera T es la EAN13 del
      // Resumen y S ya es el LM: no se toca.
      if (t_(top[i][cT]) !== '' && t_(top[i][cA]) !== 'Antequera') top[i][cS] = top[i][cT];
    }
  }

  // --- 3. Diccionario EAN (A->B, D->E), con caché 6h: EAN es catálogo maestro
  // (Reset.gs lo conserva siempre, nunca se borra) y leer sus cientos de miles
  // de filas en cada pasada era el mayor cuello de botella del proceso.
  // Si editas la hoja EAN, usa "Vaciar caché de EAN" para que se relea.
  const dictEAN = _catalogoEAN_(wsEAN);
  _marca('diccionario EAN' + (_catalogoEAN_.deCache ? ' (de caché)' : ' (leído de la hoja)'));

  // --- 4. Diccionario validación para W (TOM Pyxis|Referencia -> Cantidad) ---
  const dictVal = {};
  for (let i = 1; i < uTOM; i++) {
    const k = t_(tom[i][iTOM.pyxis]) + '|' + t_(tom[i][iTOM.referencia]);
    if (!(k in dictVal)) dictVal[k] = tom[i][iTOM.cantidad];
  }

  // --- 5. Cruces EAN->T y validación->W ---
  for (let i = 1; i < uTOP; i++) {
    // Antequera (2026-10-05): EAN y unidades vienen del RESUMEN (lo que viaja en el palé), en todas
    // las líneas (retenidas o con etiqueta). La hoja EAN solo completa la EAN si el Resumen no la
    // trae (p. ej. los códigos "48…"); las unidades NO se sustituyen por la cantidad pedida de TOM.
    if (t_(top[i][cA]) === 'Antequera') {
      if (t_(top[i][cT]) === '') { const vS = t_(top[i][cS]); if (vS in dictEAN) top[i][cT] = dictEAN[vS]; }
      continue;
    }
    if (estado[i] === 'VERDE') {
      const vS = t_(top[i][cS]), vK = t_(top[i][cK]);
      if (vS in dictEAN) top[i][cT] = dictEAN[vS];
      const combo = vK + '|' + vS;
      if (combo in dictVal) top[i][cW] = dictVal[combo];
    }
  }

  // --- 6. Reemplazo de origen (A) y cabeceras ---
  for (let i = 1; i < uTOP; i++) {
    const a = t_(top[i][cA]);
    if (CFG.ORIGENES[a]) top[i][cA] = CFG.ORIGENES[a];
  }
  const cab = { 1:'Origen',2:'Exp',6:'Tienda',7:'Nombre',8:'Proveedor',10:'Pegase',11:'Pyxis',
    12:'Flujo',13:'Agrupación',14:'SSCC Agrupación',16:'Soporte',17:'SSCC',18:'Tipo Soporte',
    19:'LM',20:'EAN',21:'Articulo',22:'Unidades',23:'Unid' };
  Object.keys(cab).forEach(c => { top[0][c - 1] = cab[c]; });
  // Antequera: V = Trae (enviadas), W = Pide (lo que pide el pedido, TOM) y X = Dif (+ sobrante / - faltante).
  const hayAntequera = top.some((f, i) => i > 0 && i < uTOP && t_(f[cA]) === 'Antequera');
  // El proveedor de Antequera va en I (no en H): la cabecera "Proveedor" de H se quita para no duplicarla.
  if (hayAntequera) { top[0][21] = 'Trae'; top[0][22] = 'Pide'; top[0][23] = 'Dif'; top[0][7] = ''; top[0][8] = 'Proveedor'; }

  // --- 7. Marcar LS-SIE (morado) — Módulo 4, con tope de complejidad por soporte.
  // Regla añadida (decisión de Pedro, 2026-08-06): un soporte con MÁS DE 2
  // artículos distintos entre sus candidatas no se retiene NADA de ese soporte
  // (sigue "LS" -> lo recoge HODOS por la regla 6). El conteo de artículos se
  // hace SOLO sobre las líneas candidatas de siempre (7a); si el soporte pasa,
  // se marcan LS-SIE TODAS sus líneas de flujo LS de esa tienda (7c), aunque
  // alguna no cumpliera individualmente el resto de condiciones (FAMILIAS,
  // columna M vacía) — la unidad de decisión es el SOPORTE, no la línea.
  let nMorado = 0, nSoportesBloqueados = 0;
  if (wsFAM) {
    const uFAM = ultimaFilaCol_(wsFAM, 2); // B
    const fam = wsFAM.getRange(1, 2, uFAM, 1).getValues();
    const codigos = {};
    for (let i = 1; i < uFAM; i++) { const c = t_(fam[i][0]); if (c !== '') codigos[c] = true; }

    // 7a. Candidatas de siempre, agrupadas por soporte: cuenta artículos
    // distintos (EAN si dictEAN lo resuelve, si no el LM) SOLO entre ellas.
    const articulosPorSoporte = {};
    for (let i = 1; i < uTOP; i++) {
      const pedido = t_(top[i][cJ]);
      const vS = t_(top[i][cS]);
      const vL = t_(top[i][cL]).toUpperCase();
      const vM = t_(top[i][cM]);
      const vG = t_(top[i][cG]).toUpperCase();
      if (pedido !== '' && vS !== '' && vL === 'LS' && vM === '' &&
          (vG === 'MARBELLA' || vG === 'MIJAS') && (vS in codigos)) {
        const soporte = t_(top[i][cP]);
        const articulo = dictEAN[vS] || vS;
        if (!articulosPorSoporte[soporte]) articulosPorSoporte[soporte] = {};
        articulosPorSoporte[soporte][articulo] = true;
      }
    }

    // 7b. Soportes que pasan el tope (<=2 artículos distintos).
    const soportesOk = {};
    Object.keys(articulosPorSoporte).forEach(sop => {
      if (Object.keys(articulosPorSoporte[sop]).length <= 2) soportesOk[sop] = true;
      else nSoportesBloqueados++;
    });

    // 7c. Marcar TODAS las líneas de flujo LS (Marbella/Mijas) de un soporte
    // que pasó el tope — no solo las candidatas de 7a.
    for (let i = 1; i < uTOP; i++) {
      const pedido = t_(top[i][cJ]);
      const vS = t_(top[i][cS]);
      const vL = t_(top[i][cL]).toUpperCase();
      const vG = t_(top[i][cG]).toUpperCase();
      if (pedido === '' || vS === '' || vL !== 'LS' || !(vG === 'MARBELLA' || vG === 'MIJAS')) continue;
      const soporte = t_(top[i][cP]);
      if (!soportesOk[soporte]) continue;
      top[i][cL] = 'LS-SIE';
      estado[i] = 'MORADO';
      nMorado++;
    }
  }

  // --- 8. Reordenar: MORADO arriba, luego VERDE, luego el resto ---
  const idx = [];
  for (let i = 1; i < uTOP; i++) idx.push(i);
  // morado primero (orden estable), después verde (ordenado G asc, K asc), después resto
  const morados = idx.filter(i => estado[i] === 'MORADO');
  const verdes = idx.filter(i => estado[i] === 'VERDE').sort((a, b) => {
    const ga = String(top[a][cG]), gb = String(top[b][cG]);
    if (ga !== gb) return ga < gb ? -1 : 1;
    const ka = String(top[a][cK]), kb = String(top[b][cK]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const resto = idx.filter(i => estado[i] === '');
  const orden = morados.concat(verdes, resto);

  const filasFinal = [top[0]];
  const estadoFinal = [''];
  orden.forEach(i => { top[i][cZ] = estado[i]; filasFinal.push(top[i]); estadoFinal.push(estado[i]); });

  // --- 9. Backgrounds por bloque (A:W = 23 col; Antequera A:X = 24 por la columna Dif), blanco por defecto ---
  // Las VERDE alternan verde claro/oscuro cada vez que cambia el Pyxis (col K).
  const ANCHO = hayAntequera ? 24 : 23;
  const fondos = [];
  let pedAnt = null, alt = false;
  for (let f = 1; f < filasFinal.length; f++) {
    const e = estadoFinal[f];
    if (e === 'MORADO') {
      fondos.push(new Array(ANCHO).fill(CFG.COLORES.MORADO));
    } else if (e === 'VERDE') {
      const k = t_(filasFinal[f][cK]);
      if (k !== pedAnt) { alt = !alt; pedAnt = k; }
      fondos.push(new Array(ANCHO).fill(alt ? CFG.COLORES.VERDE_CLARO : CFG.COLORES.VERDE_OSCURO));
    } else {
      fondos.push(new Array(ANCHO).fill(CFG.COLORES.BLANCO));
    }
  }

  _marca('cálculo en memoria (dicts, cruces, orden)');

  // --- 10. Escritura por bloques ---
  for (let r = 1; r < filasFinal.length; r++) filasFinal[r][cS] = _lmNum_(filasFinal[r][cS]); // LM (col S) entero
  wsTOP.getRange(2, cQ + 1, filasFinal.length - 1, 1).setNumberFormat('@'); // SSCC como texto (antes de escribir)
  wsTOP.getRange(1, 1, filasFinal.length, N).setValues(filasFinal);
  wsTOP.getRange(2, 1, fondos.length, ANCHO).setBackgrounds(fondos);
  wsTOP.getRange(1, 1, 1, ANCHO).setFontWeight('bold')
    .setBackground(CFG.COLORES.GRIS_CABECERA).setHorizontalAlignment('center');
  wsTOP.getRange(1, 1, filasFinal.length, ANCHO).setBorder(true, true, true, true, true, true);
  wsTOP.getRange(2, 11, fondos.length, 2).setNumberFormat('0'); // K (Pyxis) y L (Flujo)
  wsTOP.getRange(2, 19, fondos.length, 1).setNumberFormat('0'); // S (LM): entero sin decimales
  wsTOP.getRange(2, 20, fondos.length, 1).setNumberFormat('0'); // T (EAN)
  autoajustar_(wsTOP, 1, ANCHO);
  // Muestra TODAS las columnas antes de ocultar las propias: si el proceso
  // anterior (p. ej. Recepción, que oculta un juego de columnas distinto)
  // dejó otras ocultas, aquí se quedarían escondidas columnas que Arrastres
  // sí necesita ver (visto en real, 2026-09-10).
  wsTOP.showColumns(1, wsTOP.getMaxColumns());
  wsTOP.hideColumns(3, 3);  // C:E
  // I (Proveedor) se oculta salvo en Antequera: ahí lleva el proveedor (493 = stock propio; en
  // tránsito, el de la columna ENTREGA del Detalle) y se imprime con la hoja TOP.
  // Antequera: G (Nombre) se oculta porque F (Tienda) ya trae "014 Marbella" (G sigue ahí: la lógica lo usa).
  if (!hayAntequera) wsTOP.hideColumns(9); else wsTOP.hideColumns(7);   // I (Proveedor) / G (Nombre)
  // Antequera: X (Dif) se oculta y no se imprime (Pedro, 2026-10-05), pero se conserva: Hodos.gs la lee para el sobrante.
  // Y (nº de pedido proveedor, 2026-10-06) tampoco se ve ni se imprime: solo alimenta la línea de abajo de la etiqueta HODOS.
  if (hayAntequera) wsTOP.hideColumns(24, 2);
  // Antequera: además se ocultan las columnas que quedan VACÍAS en todas las líneas (H, Agrupación, SSCC
  // Agrupación, Tipo Soporte…) para que Trae · Pide quepan en la hoja y en la impresión.
  if (hayAntequera) {
    for (let c = 0; c < ANCHO; c++) {
      let vacia = true;
      for (let r = 1; r < filasFinal.length; r++) { if (t_(filasFinal[r][c]) !== '') { vacia = false; break; } }
      if (vacia) wsTOP.hideColumns(c + 1);
    }
  }
  wsTOP.hideColumns(15);    // O
  wsTOP.hideColumns(26);    // Z
  _marca('escritura TOP (valores + colores + bordes + formatos)');

  // --- 11. Alta de retenidos (acumula en RETENIDOS) ---
  const registros = [];
  const dedupRun = {}; // dedup intra-ejecución por pedido|Q (como el original)
  for (let f = 1; f < filasFinal.length; f++) {
    const e = estadoFinal[f];
    if (e !== 'VERDE' && e !== 'MORADO') continue;
    const fila = filasFinal[f];
    const vL = t_(fila[cL]).toUpperCase();

    let pyxis;
    if (e === 'MORADO') {
      pyxis = fila[cL]; // "LS-SIE" (igual que el VBA)
    } else { // VERDE
      if (vL.indexOf('CCM') !== -1 || vL.indexOf('CC2') !== -1) continue; // excluidos
      pyxis = fila[cK];
    }

    const gNorm = t_(fila[cG]).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tiendaCanon = CFG.TIENDA_ARRASTRE[gNorm];
    if (!tiendaCanon) continue;

    const pedido = t_(fila[cJ]);
    const sscc = t_(fila[cQ]);
    // Antequera: un retenido por PEDIDO (Pyxis) y palé. Un palé de stock lleva varios
    // pedidos con el mismo soporte, y su "Pedido" (J) puede ir repetido o ser el Pyxis.
    const claveRun = t_(fila[cA]) === 'Antequera' ? 'A|' + (t_(fila[cK]) || pedido) + '|' + sscc : pedido + '|' + sscc;
    if (claveRun in dedupRun) continue;
    dedupRun[claveRun] = true;

    registros.push({
      tienda: tiendaCanon, tipo: t_(fila[cA]) || 'Arrastre', flete: t_(fila[cB]), pedido: fila[cJ],
      pyxis: pyxis, agrupacion: fila[cM], sscc: fila[cQ]
    });
  }
  const res = registrarRetenidos_(registros);
  const d = res.detalle;
  const det = ['Málaga', 'Marbella', 'Mijas']
    .map(t => t + ' ' + d[t].nuevos + (d[t].repetidos ? ' (+' + d[t].repetidos + ' ya estaban)' : ''))
    .join(' · ');
  _marca('registrar retenidos');

  // --- 12. Hoja HODOS: pedidos de cerámica SIN transporte + CC2 que pierden traza ---
  const hodos = _generarHodos_(filasFinal, tom, uTOM, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT);
  _marca('generar HODOS' + (hodos.catalogoDeCache ? ' (catálogo de caché)' : ' (catálogo leído de la hoja)'));

  // Envío automático a la app HODOS, agrupado por origen+tienda+expedición
  // (ver ArrastresHodos.gs). TRAMECO no se manda (sin origen).
  const envio = _enviarLineasHodos_(hodos.lineas);
  _marca('enviar a HODOS');

  let msg = 'Arrastres OK · ' + verdes.length + ' VERDE · ' + nMorado + ' LS-SIE' +
    (nSoportesBloqueados ? ' (' + nSoportesBloqueados + ' soportes LS con >2 artículos, no retenidos)' : '') +
    ' · ' + res.total + ' nuevos → ' + det +
    ' · HODOS: ' + hodos.filas + ' líneas (' + hodos.sinTransporte + ' cerámica sin transporte, ' +
    hodos.cc2 + ' CC2, ' + hodos.ls + ' LS, ' + (hodos.antequera ? hodos.antequera + ' Antequera, ' : '') + (hodos.antDivididos ? hodos.antDivididos + ' palé(s) de cerámica Málaga divididos por pedido, ' : '') + (hodos.sobrantes ? hodos.sobrantes + ' sobrante(s), ' : '') + hodos.trameco + ' de TRAMECO)';
  if (hodos.sinCatalogo) {
    msg = '⚠️ Falta la hoja CERAMICA (catálogo de LM): HODOS solo trae los de TRAMECO. · ' + msg;
  }
  // TOM sin actualizar: se usa el último CSV que haya en Drive (Pedro, 2026-10-08), pero se dice.
  const avTom = (typeof _avisoTOMAntiguo_ === 'function') ? _avisoTOMAntiguo_(tomDatos) : '';
  if (avTom) msg = '⚠️ ' + avTom + ' · ' + msg;
  // ...o si no trae alguna de las tiendas que hay en este TOP (un export manual con otras tiendas).
  if (typeof _avisoTOMSinTiendas_ === 'function') {
    const necesarias = {};
    for (let i = 1; i < uTOP; i++) { const c = _codigoTOMdeTienda_(top[i][cG]); if (c) necesarias[c] = true; }
    const avTie = _avisoTOMSinTiendas_(tomDatos, Object.keys(necesarias));
    if (avTie) msg = '⚠️ ' + avTie + ' · ' + msg;
  }
  if (envio.ok.length || envio.fallidos.length) {
    msg += ' · Envío HODOS: ' + envio.ok.length + ' lote(s) OK';
    if (envio.fallidos.length) {
      msg += ', ' + envio.fallidos.length + ' fallido(s) (' +
        envio.fallidos.map(f => f.origen + '/' + f.destino + ': ' + f.error).join('; ') + ')';
    }
  }

  const _total = new Date().getTime() - _t0;
  Logger.log('⏱️ procesarArrastres — TOTAL ' + _total + ' ms\n  ' + _crono.join('\n  '));
  return { mensaje: msg + ' · ' + (_total / 1000).toFixed(1) + ' s', hodos: hodos, envio: envio };
}

/**
 * Envoltorio de siempre: calcula con _procesarArrastresNucleo_ (sin UI),
 * muestra el toast y abre la impresión automática (carátula + TOP) en un
 * diálogo modal — funciona igual la llame el menú o el panel (Panel.html),
 * porque SpreadsheetApp.getUi() funciona desde cualquiera de los dos.
 * Sigue devolviendo un STRING, igual que siempre: Panel.html solo sabe
 * mostrar texto (ver run() en Panel.html), así que este contrato no cambia.
 */
function procesarArrastres() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarArrastresNucleo_();
  if (r.error) { ss.toast(r.error, '🟢 Arrastres', 8); return r.error; }
  ss.toast(r.mensaje, '🟢 Arrastres', 10);

  const imp = _htmlImpresionArrastres_();
  if (!imp.error) {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(imp.html).setWidth(1000).setHeight(750),
      '🖨️ Impresión automática'
    );
  }
  return r.mensaje;
}

/**
 * Envoltorio para la web ("Panel Arrastres"): SpreadsheetApp.getUi() no existe
 * fuera del Sheet (menú/sidebar/diálogo), así que aquí NO se abre
 * showModalDialog — se devuelve el HTML de impresión para que el propio
 * cliente haga window.open + document.write, igual que ya hace
 * MecoZipForm.html con procesarZipMeco().
 */
function procesarArrastresWeb() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarArrastresNucleo_();
  if (r.error) return { error: r.error };
  ss.toast(r.mensaje, '🟢 Arrastres', 10);
  const imp = _htmlImpresionArrastres_();
  return { mensaje: r.mensaje, htmlImpresion: imp.error ? null : imp.html };
}

/**
 * Diccionario EAN (A->B, D->E) con caché 6h (CacheService, troceado por el
 * límite de 100 KB por valor — mismo patrón que el catálogo de cerámica en
 * Hodos.gs). La hoja EAN es catálogo maestro (Reset.gs la conserva siempre,
 * nunca se borra) y tiene cientos de miles de filas: leerla entera en cada
 * pasada de Arrastres era el mayor cuello de botella (más de 1 minuto).
 * Si editas la hoja EAN, usa el menú "Vaciar caché de EAN" para que se relea.
 */
function _catalogoEAN_(wsEAN) {
  const cache = CacheService.getDocumentCache();
  const NTROZOS = 'EANDIC_N', PREFIJO = 'EANDIC_';
  _catalogoEAN_.deCache = false;

  // 1. ¿Está en caché? Se guarda troceado (cada valor de caché admite ~100 KB).
  try {
    const n = cache ? cache.get(NTROZOS) : null;
    if (n) {
      const claves = [];
      for (let i = 0; i < Number(n); i++) claves.push(PREFIJO + i);
      const trozos = cache.getAll(claves);
      let txt = '';
      let completa = true;
      for (let i = 0; i < Number(n); i++) {
        const t = trozos[PREFIJO + i];
        if (t == null) { completa = false; break; }        // caché incompleta -> releer
        txt += t;
      }
      if (completa) {
        const dict = {};
        if (txt) txt.split(',').forEach(par => {
          const j = par.indexOf('|');
          if (j > 0) dict[par.substring(0, j)] = par.substring(j + 1);
        });
        _catalogoEAN_.deCache = true;
        return dict;
      }
    }
  } catch (e) { /* si la caché falla, se lee la hoja */ }

  // 2. Leer la hoja EAN entera (A->B, D->E). Los valores se pasan a texto para
  // que el resultado sea idéntico salga o no de caché (la caché solo guarda texto).
  const uEAN = ultimaFilaCol_(wsEAN, 1);
  const ean = wsEAN.getRange(1, 1, uEAN, 5).getValues();
  const dict = {};
  for (let i = 1; i < uEAN; i++) {
    const a = t_(ean[i][0]), d = t_(ean[i][3]);
    if (a !== '' && !(a in dict)) dict[a] = String(ean[i][1] == null ? '' : ean[i][1]);
    if (d !== '' && !(d in dict)) dict[d] = String(ean[i][4] == null ? '' : ean[i][4]);
  }

  // 3. Guardar en caché troceado (6 h)
  try {
    if (cache) {
      const pares = [];
      Object.keys(dict).forEach(k => pares.push(k + '|' + dict[k]));
      const txt = pares.join(',');
      const TAM = 90000;                                    // < 100 KB por valor
      const trozos = {};
      let n = 0;
      for (let p = 0; p < txt.length; p += TAM) trozos[PREFIJO + (n++)] = txt.substring(p, p + TAM);
      trozos[NTROZOS] = String(n);
      cache.putAll(trozos, 21600);                          // 6 h
    }
  } catch (e) { /* la caché es opcional */ }

  return dict;
}

/** Vacía la caché del diccionario EAN (tras editar la hoja EAN). */
function vaciarCacheEAN() {
  const cache = CacheService.getDocumentCache();
  const ss = SpreadsheetApp.getActive();
  if (!cache) { ss.toast('Sin caché disponible.', '📇 EAN', 4); return 'sin cache'; }
  const n = cache.get('EANDIC_N');
  const claves = ['EANDIC_N'];
  if (n) for (let i = 0; i < Number(n); i++) claves.push('EANDIC_' + i);
  cache.removeAll(claves);
  ss.toast('Caché de EAN vaciada. La próxima pasada releerá la hoja EAN.', '📇 EAN', 5);
  return 'ok';
}
