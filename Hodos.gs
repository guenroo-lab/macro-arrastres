/**
 * HODOS — trazabilidad de pedidos que NO se retienen
 *
 * Sustituye a la antigua hoja "Soportes Málaga" y al flujo TRAMECO -> FLUJOSTRA
 * (Generix). Todo sale ahora en una sola hoja HODOS: Tienda | Pedido.
 *
 * PROBLEMA QUE RESUELVE
 * Los pedidos que NO se retienen se mandan a tienda tal cual, pero algunos
 * pierden la trazabilidad: la etiqueta del proveedor queda inservible, o el
 * soporte trae varios pedidos mezclados y al separarlos físicamente cada
 * pedido se queda sin etiqueta propia. HODOS lista esos pedidos para poder
 * reetiquetarlos (la app HODOS genera las etiquetas; aquí solo salen números).
 *
 * REGLAS (solo cerámica; lo que no es cerámica se ignora)
 *   1. El LM (col S de TOP) tiene que estar en el catálogo CERAMICA.
 *   2. El Pyxis tiene que estar en TOM con "Tiene transporte" = NO.
 *      Si tiene transporte, ya va trazado por el flujo normal -> fuera.
 *      Si el Pyxis no aparece en TOM -> fuera (no se puede confirmar).
 *   3. Solo Málaga, Marbella y Mijas.
 *   4. Marbella / Mijas: SOLO pedidos "99" (Pegase empieza por 99).
 *      Se agrupan POR SOPORTE: si un soporte lleva varios pedidos, salen
 *      juntos en una línea como "ped+ped+ped" (una sola etiqueta de agrupación).
 *   5. Málaga:
 *      - "99"      -> entra siempre, un pedido por línea (se separan físicamente).
 *      - no "99"   -> entra SOLO si el soporte lleva más de un pedido distinto.
 *                     Con un pedido por soporte ya hay etiqueta -> hay traza -> fuera.
 *   6. LS (Torija): entra SIEMPRE (igual que CC2, sin pasar por cerámica ni
 *      transporte). Ojo: el paso 7 de Proceso_Arrastres ya convierte a
 *      "LS-SIE" las que cumplen ciertas condiciones (Marbella/Mijas + FAMILIAS)
 *      porque esas se retienen y ya tienen traza -> aquí solo llegan las que
 *      SIGUEN siendo "LS". Se agrupa por soporte usando el Pedido (col J, no
 *      el Pyxis): un mismo pedido puede repartirse en varios soportes, así que
 *      sale una línea por soporte con formato "ped+ped/soporte".
 *
 *   7. ANTEQUERA (2026-10-05): todo lo que NO se retiene lleva etiqueta, sin pasar
 *      por cerámica, transporte ni regla "99". Una línea por PALÉ (soporte del
 *      Resumen) con sus pedidos (Pyxis): uno, o varios unidos con "+" (agrupación).
 *      Las líneas VERDE/MORADO (retenidas) no entran. Además, cada SOBRANTE (el palé trae más
 *      unidades de las que pide el pedido, col X > 0) lleva su propia etiqueta
 *      "SOBRANTE + N UDS + LM + PED". Ver AntequeraPlan.gs.
 *      EXCEPCIÓN MÁLAGA + CERÁMICA (Pedro, 2026-10-05): la cerámica de Málaga va siempre en soportes por
 *      pedido, nunca en agrupación. Si un palé de Málaga lleva cerámica (LM en CERAMICA; sin catálogo se asume
 *      que sí) y más de un pedido, NO sale "ped+ped": sale UNA etiqueta por pedido no retenido (el palé se
 *      divide físicamente en un soporte por pedido). Marbella y Mijas siguen con agrupación.
 *
 * Además se vuelcan los pedidos de TRAMECO (lo que antes iba a FLUJOSTRA con
 * la "M" delante): ahora van a HODOS con el número limpio, sin prefijo.
 *
 * La hoja se reconstruye entera en cada pasada (no acumula).
 */

/**
 * Línea de abajo de la etiqueta HODOS de Antequera (Pedro, 2026-10-06): "PED. PROV. 81406165" = nº de pedido proveedor
 * (Pegase) de los pedidos de la etiqueta. Varios se separan con " / " (máx. 3, luego " +N"); sin ninguno, vacío.
 */
function _sufijoPedProv_(nums) {
  const u = [];
  (nums || []).forEach(n => { const s = t_(n); if (s !== '' && u.indexOf(s) === -1) u.push(s); });
  if (!u.length) return '';
  return 'PED. PROV. ' + u.slice(0, 3).join(' / ') + (u.length > 3 ? ' +' + (u.length - 3) : '');
}

/** Subsecciones de la Sección 6 que se consideran cerámica (referencia). */
const HODOS_SUBSECCIONES_CERAMICA = [1, 2, 3, 4, 5, 10, 20, 70, 80];

/** Códigos de tienda válidos para el volcado de TRAMECO (sin E043 ni E102). */
const HODOS_TIENDAS_TRAMECO = { 'E036': 'Málaga', 'E014': 'Marbella', 'E279': 'Mijas' };

/**
 * Catálogo de LM de cerámica como objeto {lm: true}.
 * La hoja CERAMICA tiene ~63.000 filas: leerla en cada pasada es lento, así que
 * el resultado se guarda en caché 6 h. La primera pasada del día lee la hoja;
 * el resto se la salta. Si editas la hoja CERAMICA y quieres que se note ya,
 * usa el menú "Vaciar caché de cerámica".
 */
function _catalogoCeramica_() {
  const cache = CacheService.getDocumentCache();
  const NTROZOS = 'CERAM_N', PREFIJO = 'CERAM_';
  _catalogoCeramica_.deCache = false;   // lo consulta _generarHodos_ para el cronómetro

  // 1. ¿Está en caché? Se guarda troceado (cada valor de caché admite ~100 KB).
  try {
    const n = cache ? cache.get(NTROZOS) : null;
    if (n) {
      const claves = [];
      for (let i = 0; i < Number(n); i++) claves.push(PREFIJO + i);
      const trozos = cache.getAll(claves);
      let txt = '';
      for (let i = 0; i < Number(n); i++) {
        const t = trozos[PREFIJO + i];
        if (t == null) { txt = null; break; }              // caché incompleta -> releer
        txt += t;
      }
      if (txt) {
        const set = {};
        txt.split(',').forEach(c => { if (c) set[c] = true; });
        _catalogoCeramica_.deCache = true;
        return set;
      }
    }
  } catch (e) { /* si la caché falla, se lee la hoja */ }

  // 2. Leer la hoja CERAMICA (columna A = LM).
  const ws = SpreadsheetApp.getActive().getSheetByName(CFG.HOJAS.CERAMICA);
  if (!ws) return null;                                    // sin catálogo no se puede filtrar
  const last = ws.getLastRow();
  if (last < 2) return null;
  const vals = ws.getRange(2, 1, last - 1, 1).getValues();

  const set = {};
  const lista = [];
  for (let i = 0; i < vals.length; i++) {
    const lm = _lmNum_(vals[i][0]);
    if (lm === '' || lm == null) continue;
    const s = String(lm);
    if (!(s in set)) { set[s] = true; lista.push(s); }
  }

  // 3. Guardar en caché troceado (6 h).
  try {
    if (cache && lista.length) {
      const txt = lista.join(',');
      const TAM = 90000;                                    // < 100 KB por valor
      const trozos = {};
      let n = 0;
      for (let p = 0; p < txt.length; p += TAM) trozos[PREFIJO + (n++)] = txt.substring(p, p + TAM);
      trozos[NTROZOS] = String(n);
      cache.putAll(trozos, 21600);                          // 6 h
    }
  } catch (e) { /* la caché es opcional */ }

  return set;
}

/** Vacía la caché del catálogo de cerámica (tras editar la hoja CERAMICA). */
function vaciarCacheCeramica() {
  const cache = CacheService.getDocumentCache();
  const ss = SpreadsheetApp.getActive();
  if (!cache) { ss.toast('Sin caché disponible.', '🧱 Cerámica', 4); return 'sin cache'; }
  const n = cache.get('CERAM_N');
  const claves = ['CERAM_N'];
  if (n) for (let i = 0; i < Number(n); i++) claves.push('CERAM_' + i);
  cache.removeAll(claves);
  ss.toast('Caché de cerámica vaciada. La próxima pasada releerá la hoja CERAMICA.', '🧱 Cerámica', 5);
  return 'ok';
}

/**
 * Diccionario Pyxis -> "tiene transporte" leyendo TOM.
 * cPyxis/cTransporte: índices 0-based localizados por cabecera (ver
 * _indicesTOM_ en Menu.gs) — TOM puede venir de Pedidos_Vivos_lineas (14 col)
 * o de pedidos_totales.csv (110 col, columnas en otro orden); no se asume posición fija.
 * Se reutiliza la matriz de TOM ya leída por procesarArrastres (no se relee la hoja).
 */
function _transportePorPyxis_(tom, uTOM, cPyxis, cTransporte) {
  const dict = {};
  for (let i = 1; i < uTOM; i++) {
    const pyx = t_(tom[i][cPyxis]);
    if (pyx === '' || (pyx in dict)) continue;
    dict[pyx] = t_(tom[i][cTransporte]).toUpperCase();       // 'SI' | 'NO' | ''
  }
  return dict;
}

/**
 * Diccionario Pegase -> Pyxis leyendo TOM, para el flujo "CC" (proveedor
 * directo / Agrupación), que llega a TOP sin Pyxis en columna K.
 * cPegase/cPyxis: índices 0-based localizados por cabecera (ver _indicesTOM_).
 * Una vez recuperado el Pyxis, la fila sigue el mismo camino que cualquier
 * otra (cerámica + _transportePorPyxis_ para "tiene transporte"/gastos de envío).
 */
function _pyxisPorPegase_(tom, uTOM, cPegase, cPyxis) {
  const dict = {};
  for (let i = 1; i < uTOM; i++) {
    const pegase = t_(tom[i][cPegase]);
    if (pegase === '' || (pegase in dict)) continue;
    dict[pegase] = t_(tom[i][cPyxis]);
  }
  return dict;
}

/**
 * Devuelve el LM real de una fila de TOP.
 *
 * OJO — las filas de pedido de tienda (las que traen Pyxis, incluidas las "99")
 * NO llevan el LM en la columna S: ahí viene un código interno con prefijo "C"
 * (p. ej. "C18133052") y el LM de verdad está en la columna T ("90323676").
 * procesarArrastres solo copia T sobre S en las filas VERDE, y HODOS trabaja
 * justo con las que NO son verde, así que aquí hay que resolverlo a mano.
 */
function _lmDeFila_(fila, cS, cT) {
  const s = t_(fila[cS]);
  const t = t_(fila[cT]);
  if (s !== '' && !/^C/i.test(s)) return String(_lmNum_(s));   // S ya es el LM
  if (t !== '') return String(_lmNum_(t));                     // S es "C..." -> el LM está en T
  return s === '' ? '' : String(_lmNum_(s));
}

/**
 * Genera la hoja HODOS a partir de las filas ya procesadas de TOP.
 * filasFinal: matriz de TOP tras procesar (fila 0 = cabecera).
 * tom/uTOM: matriz de TOM ya leída (para el cruce de transporte).
 * Índices 0-based en TOP: cG=Tienda, cJ=Pegase, cK=Pyxis, cL=Flujo, cP=Soporte, cS=LM, cT=EAN/LM.
 * iTOM: índices 0-based de columnas de TOM localizadas por cabecera (ver _indicesTOM_, Menu.gs).
 */
function _generarHodos_(filasFinal, tom, uTOM, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT) {
  const ss = SpreadsheetApp.getActive();
  const ceramica = _catalogoCeramica_();
  const transporte = _transportePorPyxis_(tom, uTOM, iTOM.pyxis, iTOM.transporte);
  const pyxisPorPegase = _pyxisPorPegase_(tom, uTOM, iTOM.pegase, iTOM.pyxis);

  // --- 1. Filtrar las líneas candidatas y agruparlas por tienda/soporte ---
  // porTienda[tienda] = { soportes: { soporte: {pedidos:{}, orden:[], tiene99:bool} },
  //                       sueltos99: { pedido: true } }  (Málaga: 99 van sueltos)
  // Cada soporte se etiqueta con un "modo" que dice cómo se vuelca en el paso 2:
  //   'junto'        -> siempre entra, pedidos unidos con "+" (Marbella/Mijas 99, y CC2 en cualquier tienda)
  //   'malaga_no99'  -> solo entra si el soporte tiene MÁS DE UN pedido, y entonces van separados
  // Si un mismo soporte recibe primero 'malaga_no99' y luego una línea CC2 (o al
  // revés), gana 'junto' (CC2 siempre debe salir, así que es el modo más permisivo).
  const porTienda = {};
  const lsPorTienda = {};   // LS (Torija): independiente de porTienda, línea propia por soporte
  const TIENDAS = { 'MALAGA': 'Málaga', 'MARBELLA': 'Marbella', 'MIJAS': 'Mijas' };
  const antPorTienda = {};  // Antequera: una etiqueta por palé, independiente del resto de reglas
  const antSobrantes = {};  // Antequera: una etiqueta por cada SOBRANTE (trae más de lo que pide el pedido)
  const antMalaga = {};     // Antequera/Málaga: por palé, todos sus pedidos y si lleva cerámica (=> un soporte por pedido)
  let sinCatalogo = (ceramica === null);
  let nCeramica = 0, nSinTransporte = 0, nCC2 = 0, nLS = 0, nAntequera = 0, nSobrantes = 0, nAntDivididos = 0;

  const _grupo_ = (tienda, soporte, modo, origen, expedicion) => {
    if (!porTienda[tienda]) porTienda[tienda] = { soportes: {}, orden: [], sueltos: {}, ordenSueltos: [], origenSueltos: {}, expSueltos: {} };
    const T = porTienda[tienda];
    if (!(soporte in T.soportes)) {
      T.soportes[soporte] = { pedidos: {}, orden: [], modo: modo, origen: origen, expedicion: expedicion };
      T.orden.push(soporte);
    } else if (modo === 'junto') T.soportes[soporte].modo = 'junto';   // 'junto' manda
    return T;
  };

  for (let f = 1; f < filasFinal.length; f++) {
    const fila = filasFinal[f];
    const gNorm = t_(fila[cG]).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tienda = TIENDAS[gNorm];
    if (!tienda) continue;                                    // solo Málaga/Marbella/Mijas

    const origenFila = t_(fila[cA]);
    const expedicionFila = t_(fila[cB]);

    // --- Antequera (2026-10-05): TODO lo que no se retiene lleva etiqueta, una por PALÉ
    // (soporte del Resumen), solo con sus pedidos. Sin cerámica, sin filtro de transporte
    // ni regla "99": el transporte ya decidió qué se retiene (VERDE, col Z) y lo demás
    // va a tienda con traza. Un palé con varios pedidos = una agrupación ("ped+ped").
    // Si el palé es mixto, los de transporte ya son VERDE y aquí solo quedan los otros.
    if (origenFila === 'Antequera') {
      // SOBRANTE: el palé trae más unidades de las que pide el pedido (col X = Dif > 0, ver AntequeraPlan.gs).
      // Esas unidades no corresponden a ningún pedido: etiqueta propia "SOBRANTE / N UDS / LM / PED", aunque
      // el pedido se retenga (el exceso va a tienda, no se retiene).
      const difA = parseFloat(String(fila[23] == null ? '' : fila[23]).replace(',', '.'));
      if (difA > 0 && t_(fila[cK]) !== '' && t_(fila[cS]) !== '') {
        if (!antSobrantes[tienda]) antSobrantes[tienda] = [];
        antSobrantes[tienda].push({ texto: ['SOBRANTE', (Math.round(difA * 100) / 100) + ' UDS', 'LM ' + t_(fila[cS]), 'PED ' + t_(fila[cK])].join('+'), expedicion: expedicionFila, sufijo: _sufijoPedProv_([fila[24]]) });
        nSobrantes++;
      }
      const pyxA = t_(fila[cK]), sopA = t_(fila[cP]);
      // MÁLAGA + CERÁMICA (2026-10-05, Pedro): la cerámica de Málaga va SIEMPRE en soportes por pedido; nunca una
      // agrupación de cerámica con pedidos distintos. Se anota, por palé, todos sus pedidos (retenidos o no) y si
      // lleva cerámica (LM en el catálogo CERAMICA; sin catálogo se asume que sí, para no romper la regla).
      if (tienda === 'Málaga' && pyxA !== '' && sopA !== '') {
        const lmA = _lmDeFila_(fila, cS, cT);
        const esCerA = ceramica ? (lmA !== '' && (lmA in ceramica)) : true;
        const IM = antMalaga[sopA] || (antMalaga[sopA] = { pedidos: [], ceramica: false });
        if (IM.pedidos.indexOf(pyxA) === -1) IM.pedidos.push(pyxA);
        if (esCerA) IM.ceramica = true;
      }
      const estA = t_(fila[25]);                                   // col Z: 'VERDE' | 'MORADO' | ''
      if (estA === 'VERDE' || estA === 'MORADO') continue;          // retenido: ya tiene traza por RETENIDOS
      if (pyxA === '' || sopA === '') continue;                      // sin pedido resuelto: el volcado ya avisó (REVISAR)
      nAntequera++;
      if (!antPorTienda[tienda]) antPorTienda[tienda] = { soportes: {}, orden: [] };
      const TA = antPorTienda[tienda];
      if (!(sopA in TA.soportes)) { TA.soportes[sopA] = { pedidos: [], expedicion: expedicionFila, pegProv: {} }; TA.orden.push(sopA); }
      if (TA.soportes[sopA].pedidos.indexOf(pyxA) === -1) TA.soportes[sopA].pedidos.push(pyxA);
      // Nº de pedido proveedor (col Y) de cada pedido del palé: va en la línea de abajo de la etiqueta (Pedro, 2026-10-06)
      if (t_(fila[24]) !== '') (TA.soportes[sopA].pegProv[pyxA] = TA.soportes[sopA].pegProv[pyxA] || []).push(t_(fila[24]));
      continue;
    }

    let pyxis = t_(fila[cK]);
    const soporte = t_(fila[cP]);
    // CC (proveedor directo/Agrupación): no trae Pyxis en K. Se recupera
    // cruzando el Pedido (Pegase, col J) contra TOM (col M). A partir de ahí
    // la fila sigue el camino normal (cerámica + transporte por ese Pyxis).
    if (pyxis === '' && t_(fila[cL]).toUpperCase() === 'CC') {
      pyxis = pyxisPorPegase[t_(fila[cJ])] || '';
    }
    if (pyxis === '' || soporte === '') continue;

    // --- CC2: entra SIEMPRE, da igual la referencia (no cerámica) y da igual
    // el transporte — este flujo nunca se retiene (procesarArrastres ya lo
    // excluye de RETENIDOS siempre), así que siempre necesita traza. Se agrupa
    // por soporte igual en las 3 tiendas, sin la separación especial de Málaga.
    if (t_(fila[cL]).toUpperCase() === 'CC2') {
      nCC2++;
      const T = _grupo_(tienda, soporte, 'junto', origenFila, expedicionFila);
      const S = T.soportes[soporte];
      if (!(pyxis in S.pedidos)) { S.pedidos[pyxis] = true; S.orden.push(pyxis); }
      continue;
    }

    // --- LS (Torija): entra SIEMPRE, sin cerámica ni transporte. Las que el
    // paso 7 de Proceso_Arrastres ya convirtió a "LS-SIE" no coinciden aquí
    // (ya se retienen). Se agrupa por soporte con el Pedido (col J), no el
    // Pyxis, porque un mismo pedido puede repartirse en varios soportes.
    if (t_(fila[cL]).toUpperCase() === 'LS') {
      nLS++;
      const pedido = t_(fila[cJ]);
      if (pedido !== '') {
        if (!lsPorTienda[tienda]) lsPorTienda[tienda] = { soportes: {}, orden: [] };
        const T = lsPorTienda[tienda];
        if (!(soporte in T.soportes)) {
          T.soportes[soporte] = { pedidos: {}, orden: [], origen: origenFila, expedicion: expedicionFila };
          T.orden.push(soporte);
        }
        const S = T.soportes[soporte];
        if (!(pedido in S.pedidos)) { S.pedidos[pedido] = true; S.orden.push(pedido); }
      }
      continue;
    }

    if (!ceramica) continue;

    // 1. cerámica (el LM puede estar en S o en T, ver _lmDeFila_)
    const lm = _lmDeFila_(fila, cS, cT);
    if (lm === '' || !(lm in ceramica)) continue;
    nCeramica++;

    // 2. sin transporte según TOM (y que exista en TOM)
    const tr = transporte[pyxis];
    if (tr === undefined) continue;                          // no está en TOM -> fuera
    if (tr === 'SI') continue;                                // tiene transporte -> fuera
    nSinTransporte++;

    const es99 = t_(fila[cJ]).substring(0, 2) === '99';

    // 3/4. reglas por tienda
    if (tienda === 'Málaga' && es99) {
      // Málaga + 99 -> pedido suelto (se separa físicamente aunque comparta soporte)
      const T = _grupo_(tienda, soporte, 'malaga_no99', origenFila, expedicionFila);   // por si el soporte ya existe sin modo
      if (!(pyxis in T.sueltos)) {
        T.sueltos[pyxis] = true; T.ordenSueltos.push(pyxis);
        T.origenSueltos[pyxis] = origenFila; T.expSueltos[pyxis] = expedicionFila;
      }
      continue;
    }
    if (tienda !== 'Málaga' && !es99) continue;              // Marbella/Mijas: solo 99

    // Resto: Marbella/Mijas 99 -> 'junto'; Málaga no-99 -> 'malaga_no99'
    const modo = (tienda === 'Málaga') ? 'malaga_no99' : 'junto';
    const T = _grupo_(tienda, soporte, modo, origenFila, expedicionFila);
    const S = T.soportes[soporte];
    if (!(pyxis in S.pedidos)) { S.pedidos[pyxis] = true; S.orden.push(pyxis); }
  }

  // --- 2. Construir las filas de salida (hoja) y las líneas para HODOS ---
  const salida = [];
  const lineas = [];
  ['Málaga', 'Marbella', 'Mijas'].forEach(tienda => {
    const T = porTienda[tienda];
    if (T) {
      // Málaga: los 99 sueltos, uno por línea
      T.ordenSueltos.forEach(p => {
        salida.push([tienda, p]);
        lineas.push({ tienda: tienda, texto: p, origen: T.origenSueltos[p], expedicion: T.expSueltos[p] });
      });

      // Agrupados por soporte, según el modo que ganó para cada uno
      T.orden.forEach(sop => {
        const S = T.soportes[sop];
        if (S.modo === 'malaga_no99') {
          // solo si el soporte lleva MÁS DE UN pedido (si no, ya hay traza)
          if (S.orden.length < 2) return;
          S.orden.forEach(p => {
            salida.push([tienda, p]);      // separados: uno por línea
            lineas.push({ tienda: tienda, texto: p, origen: S.origen, expedicion: S.expedicion });
          });
        } else {
          // 'junto': una línea por soporte, pedidos unidos con "+"
          const texto = S.orden.join('+');
          salida.push([tienda, texto]);
          lineas.push({ tienda: tienda, texto: texto, origen: S.origen, expedicion: S.expedicion });
        }
      });
    }

    // LS (Torija): una línea por soporte, "ped+ped/soporte"
    const L = lsPorTienda[tienda];
    if (L) {
      L.orden.forEach(sop => {
        const S = L.soportes[sop];
        const texto = S.orden.join('+') + '/' + sop;
        salida.push([tienda, texto]);
        lineas.push({ tienda: tienda, texto: texto, origen: S.origen, expedicion: S.expedicion });
      });
    }

    // Antequera: una etiqueta por palé con sus pedidos no retenidos (uno, o "ped+ped" = agrupación)
    const A = antPorTienda[tienda];
    if (A) {
      A.orden.forEach(sop => {
        const S = A.soportes[sop];
        // Málaga + cerámica + más de un pedido en el palé: se divide en un soporte por pedido -> UNA etiqueta por pedido
        // (nunca "ped+ped"). Si el palé es mixto (alguno retenido), aquí solo quedan los no retenidos.
        const IM = (tienda === 'Málaga') ? antMalaga[sop] : null;
        if (IM && IM.ceramica && IM.pedidos.length > 1) {
          nAntDivididos++;
          S.pedidos.forEach(p => {
            salida.push([tienda, p]);
            lineas.push({ tienda: tienda, texto: p, origen: 'Antequera', expedicion: S.expedicion, sufijo: _sufijoPedProv_(S.pegProv[p]) });
          });
          return;
        }
        const texto = S.pedidos.join('+');
        salida.push([tienda, texto]);
        lineas.push({ tienda: tienda, texto: texto, origen: 'Antequera', expedicion: S.expedicion,
          sufijo: _sufijoPedProv_([].concat.apply([], S.pedidos.map(p => S.pegProv[p] || []))) });
      });
    }
    (antSobrantes[tienda] || []).forEach(x => {
      salida.push([tienda, x.texto]);
      lineas.push({ tienda: tienda, texto: x.texto, origen: 'Antequera', expedicion: x.expedicion, sufijo: x.sufijo });
    });
  });

  // --- 3. Añadir los pedidos de TRAMECO (lo que antes iba a FLUJOSTRA).
  // Sin origen: no se mandan a HODOS (decisión del usuario). ---
  const tra = _pedidosTrameco_();
  tra.forEach(r => { salida.push(r); lineas.push({ tienda: r[0], texto: r[1], origen: null, expedicion: null }); });

  // --- 4. Escribir la hoja HODOS (se reconstruye entera) ---
  let ws = ss.getSheetByName(CFG.HOJAS.HODOS);
  if (ws) ws.clear();
  else ws = ss.insertSheet(CFG.HOJAS.HODOS);

  ws.getRange(1, 1, 1, 2).setValues([['Tienda', 'Pedido']])
    .setFontWeight('bold').setBackground(CFG.COLORES.GRIS_CABECERA).setHorizontalAlignment('center');

  if (salida.length) {
    const rng = ws.getRange(2, 1, salida.length, 2);
    rng.setNumberFormat('@');                                // texto: conserva "+" y ceros
    rng.setValues(salida);
    ws.getRange(1, 1, salida.length + 1, 2).setBorder(true, true, true, true, true, true);
  }
  ws.setColumnWidth(1, 110);
  ws.setColumnWidth(2, 260);

  return {
    filas: salida.length,
    lineas: lineas,
    ceramica: nCeramica,
    sinTransporte: nSinTransporte,
    cc2: nCC2,
    ls: nLS,
    antequera: nAntequera,
    antDivididos: nAntDivididos,
    sobrantes: nSobrantes,
    trameco: tra.length,
    sinCatalogo: sinCatalogo,
    catalogoDeCache: !!_catalogoCeramica_.deCache
  };
}

/**
 * Pedidos de TRAMECO para HODOS. Antes iban a FLUJOSTRA con una "M" delante
 * (Generix); ahora van aquí con el número limpio, sin prefijo, y solo para
 * Málaga/Marbella/Mijas (E043 y E102 ya no se operan).
 * TRAMECO: col A = código de tienda, col D = pedido.
 */
function _pedidosTrameco_() {
  const ws = SpreadsheetApp.getActive().getSheetByName(CFG.HOJAS.TRAMECO);
  if (!ws) return [];
  const last = ultimaFilaCol_(ws, 1);
  if (last < 2) return [];
  const vals = ws.getRange(1, 1, last, 4).getValues();

  const out = [], visto = {};
  for (let i = 1; i < last; i++) {
    const tienda = HODOS_TIENDAS_TRAMECO[t_(vals[i][0]).toUpperCase()];
    if (!tienda) continue;
    let ped = t_(vals[i][3]);
    if (ped === '') continue;
    ped = ped.replace(/^[VM]+/i, '');                        // fuera prefijos "V"/"M" antiguos
    if (ped === '') continue;
    const clave = tienda + '|' + ped;
    if (clave in visto) continue;
    visto[clave] = true;
    out.push([tienda, ped]);
  }
  return out;
}
