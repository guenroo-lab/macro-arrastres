/**
 * ANTEQUERA v2 · ANÁLISIS DE LA EXPEDICIÓN (Resumen + Detalle + Bultos)
 *
 * Sustituye al volcado antiguo (volcarAntequeraTOP, que sigue en Antequera.gs
 * solo para el diálogo del menú del Sheet). Aquí NO se escribe nada: se
 * analiza la expedición y se devuelve el plan palé por palé (vista previa).
 * Lo que se vuelca a TOP es lo que sale de aquí (ver volcarAntequeraLineasTOP).
 *
 * POR QUÉ ASÍ (comprobado con PDF reales de Antequera, 2026-10-05):
 *  - El número real del palé es el SOPORTE del Resumen/Bultos (el que lleva la
 *    etiqueta física "SOPORTE PICKING"). El "Contenido" del Detalle, en los
 *    palés de proveedor, es otro número que no está en ninguna etiqueta.
 *  - El Detalle solo enseña UN pedido por palé (el de la última línea); el
 *    Resumen trae todas las líneas de todos los palés. Por eso la base es el
 *    RESUMEN, no el Detalle.
 *  - Dos flujos en el Resumen:
 *      STOCK    (preparado en Antequera): REFERENCIA = código logístico "C…"
 *               (no cotejable), el LM va en REFLM y el pedido de cliente
 *               (Pyxis) + cliente en MENSAJE.
 *      TRÁNSITO (de proveedor): el LM va en REFERENCIA, REFLM vacío y no hay
 *               pedido -> se busca en TOM por LM + unidades + tienda (el
 *               Pegase del Detalle desempata).
 *  - Todos los CC tienen pedido de cliente, aunque el PDF no lo enseñe.
 *
 * REGLAS (decididas por Pedro, 2026-10-05):
 *  - Se retiene el PEDIDO que tiene transporte (TOM "Tiene transporte" = SI).
 *  - Todo lo demás lleva etiqueta HODOS: una por palé, solo con los pedidos
 *    (uno, o varios unidos con "+" = agrupación). En un palé mixto se retiran
 *    los de transporte y la etiqueta lleva solo los restantes.
 *  - Lo que no se pueda casar se marca REVISAR; nunca se descarta en silencio.
 */

/** Proveedor de los palés de STOCK: el almacén de Antequera (493) es el origen, es stock propio. */
const ANQ_PROVEEDOR_STOCK = '493';

/** Nombre de proveedor del Detalle (columna ENTREGA, que el PDF corta: "ECOCERAMIC (" -> "ECOCERAMIC"). */
function _anqProveedor_(v) {
  return t_(v).replace(/\s*\($/, '').replace(/\s+/g, ' ');
}

/** Cantidad numérica tolerante ("18", "1.00", "1,5"). NaN -> 0. */
function _anqNum_(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** LM sin el sufijo de 3 dígitos de los códigos "48…" (igual que el paso 0 de Proceso_Arrastres). */
function _anqLm_(raw) {
  const s = t_(raw).replace(/\.0+$/, '');
  return (s.substring(0, 2) === '48' && s.length > 3) ? s.substring(0, s.length - 3) : s;
}

function _anqUniq_(arr) {
  const visto = {}, out = [];
  arr.forEach(x => { if (x !== '' && !(x in visto)) { visto[x] = true; out.push(x); } });
  return out;
}

/** Código de tienda "E014" / "014" / "14" -> número (14). 0 si no se puede. */
function _anqCodigoTienda_(c) {
  const d = String(c == null ? '' : c).replace(/\D/g, '');
  return d === '' ? 0 : parseInt(d, 10);
}

/**
 * Punto de entrada desde la web: lee TOM (Drive) y analiza.
 * entrada = { exp, tienda, tiendaCodigo, resumen:[], detalle:[], bultos:{}|null }
 */
function analizarAntequera(entrada) {
  const r = analizarAntequeraVarias([entrada]);
  if (r.error) return { error: r.error };
  return r.planes[0];
}

/**
 * Varias expediciones a la vez (una, dos o tres: Málaga, Marbella, Mijas; incluso dos de la misma tienda).
 * TOM y el catálogo de cerámica se leen UNA sola vez. entradas = [entrada, ...], cada una como en analizarAntequera.
 * Devuelve { ok, planes: [plan | { ok:false, error, exp, tienda }], avisos: [] }. Un error en una expedición no
 * tumba las demás: el cliente lo enseña en rojo y no la procesa.
 */
function analizarAntequeraVarias(entradas) {
  const lista = (entradas || []).filter(e => e && (e.resumen || []).length);
  if (!lista.length) return { error: 'Falta el "Resumen de albaranes": es la base (trae soporte, LM y unidades de cada palé).' };
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
  // Málaga: la cerámica va en soportes por pedido (ver _anqAnalizar_). Se necesita el catálogo CERAMICA (en caché 6 h).
  let ceramica = null;
  if (lista.some(e => t_(e.tienda) === 'Málaga')) {
    try { ceramica = _catalogoCeramica_(); } catch (e) { ceramica = null; }
  }
  return _anqAnalizarVarias_(lista, tomDatos, ceramica);
}

/** Parte pura de analizarAntequeraVarias (se prueba en Node con TOM real). */
function _anqAnalizarVarias_(lista, tomDatos, ceramica) {
  const planes = lista.map(e => {
    const p = _anqAnalizar_(e, tomDatos, ceramica);
    if (p.error) return { ok: false, error: p.error, exp: t_(e.exp), tienda: t_(e.tienda) };
    return p;
  });
  const avisos = [];
  // Un mismo soporte en dos expediciones no puede ser: casi seguro se subió un PDF equivocado.
  const dondeEsta = {};
  planes.forEach(p => {
    if (!p.ok) return;
    (p.palets || []).forEach(pal => { (dondeEsta[pal.soporte] = dondeEsta[pal.soporte] || []).push(p.tienda + ' · exp ' + p.exp); });
  });
  Object.keys(dondeEsta).forEach(s => {
    if (dondeEsta[s].length > 1) avisos.push('El soporte ' + s + ' sale en varias expediciones (' + dondeEsta[s].join(' y ') + '): revisa que los PDF sean de cada tienda.');
  });
  // TOM sin actualizar (se usa igualmente el último que haya en la carpeta): los pedidos posteriores no estarán.
  const avTom = (typeof _avisoTOMAntiguo_ === 'function') ? _avisoTOMAntiguo_(tomDatos) : '';
  if (avTom) avisos.unshift(avTom + '. Los pedidos hechos después no están en él: saldrán como "sin pedido" (REVISAR).');
  return { ok: planes.some(p => p.ok), planes: planes, avisos: avisos };
}

/**
 * Análisis puro (sin Sheets ni Drive): se prueba en Node con TOM real.
 * tomDatos = { filas, iTOM } (filas[0] = cabecera). iTOM.tienda es opcional.
 * ceramica = catálogo de LM de cerámica { lm: true } (solo cuenta en Málaga) o null si no se pudo leer:
 * entonces se asume que TODO es cerámica (la regla de Málaga manda) y se avisa.
 *
 * REGLA MÁLAGA (Pedro, 2026-10-05): la cerámica de Málaga va SIEMPRE en soportes por pedido; nunca una
 * agrupación de cerámica con pedidos distintos. Un palé de Málaga con cerámica y más de un pedido queda marcado
 * `dividir` (hay que separarlo en un soporte por pedido) y sus etiquetas HODOS son UNA POR PEDIDO, no "ped+ped"
 * (Hodos.gs lo hace igual al generar las etiquetas). Marbella y Mijas no cambian.
 */
function _anqAnalizar_(entrada, tomDatos, ceramica) {
  const E = entrada || {};
  const tienda = t_(E.tienda);
  if (['Málaga', 'Marbella', 'Mijas'].indexOf(tienda) === -1) {
    return { error: 'Tienda no reconocida: "' + (tienda || E.tiendaCodigo || '?') + '". Antequera sirve a Málaga, Marbella y Mijas.' };
  }
  const resumenTodo = (E.resumen || []).filter(r => /^\d{5,}$/.test(t_(r.soporte)));
  if (!resumenTodo.length) {
    return { error: 'Falta el "Resumen de albaranes": es la base (trae soporte, LM y unidades de cada palé).' };
  }
  const detalle = E.detalle || [];
  const bultos = E.bultos || null;
  const codTienda = _anqCodigoTienda_(E.tiendaCodigo);
  const avisos = [];

  // ---- Detalle: Pegase / Pyxis por contenido, y "Ya entregado" ----
  const pegDet = {}, pyxDet = {}, porPegase = {}, porContenido = {}, yaEntregado = {};
  let detalleVivas = 0;
  detalle.forEach(d => {
    const pp = String(d.pedido || '').split('/');
    let ped = t_(pp[0]), pyx = t_(pp[1]);
    if (!pyx && /^\d{6}$/.test(ped)) { pyx = ped; ped = ''; }   // 6 dígitos sin "/": es el Pyxis, no el Pegase
    const cont = t_(d.contenido);
    const fila = { pegase: ped, pyxis: pyx, contenido: cont, entrega: t_(d.entrega), tipo: t_(d.tipo), seccion: t_(d.seccion) };
    if (/YA ENTREGADO/i.test(fila.entrega)) { if (cont) yaEntregado[cont] = true; return; }
    detalleVivas++;
    if (ped) { pegDet[ped] = true; (porPegase[ped] = porPegase[ped] || []).push(fila); }
    if (pyx) pyxDet[pyx] = true;
    if (cont) porContenido[cont] = fila;
  });

  // ---- Líneas del Resumen (se omiten los palés "Ya entregado") ----
  const lineas = [];
  const omitidos = {};
  resumenTodo.forEach(r => {
    const sop = t_(r.soporte);
    if (yaEntregado[sop]) { omitidos[sop] = true; return; }
    const esStock = /^C\d/i.test(t_(r.referencia)) && t_(r.reflm) !== '';
    const lmRaw = esStock ? t_(r.reflm) : t_(r.referencia);
    const m = /^(\d{5,7})(?:\s|$)/.exec(t_(r.mensaje));
    lineas.push({
      soporte: sop, flujo: (t_(r.flujo) || 'CC').toUpperCase(), esStock: esStock,
      lmRaw: lmRaw, lm: _anqLm_(lmRaw), uds: _anqNum_(r.unidades), ean: t_(r.ean).replace(/\D/g, ''),
      pyxMensaje: m ? m[1] : '', exp: t_(r.exp).replace(/^0+/, ''), cliente: t_(r.cliente),
      pyxis: '', pegase: '', como: '', desc: '', aviso: '', proveedor: '', pide: null, sobra: 0, falta: 0
    });
  });
  Object.keys(omitidos).forEach(s => avisos.push('Palé ' + s + ' marcado "Ya entregado" en el Detalle: se omite.'));
  if (!lineas.length) return { error: 'Todos los palés del Resumen figuran como "Ya entregado". No hay nada que procesar.' };

  // ---- TOM: una sola pasada ----
  const filas = tomDatos.filas, iT = tomDatos.iTOM;
  const necesitoLM = {};
  lineas.forEach(l => { necesitoLM[l.lm] = true; });
  const lineasPorLM = {}, transporte = {};
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const pyx = t_(f[iT.pyxis]);
    if (pyx !== '' && !(pyx in transporte)) transporte[pyx] = t_(f[iT.transporte]).toUpperCase();
    const ref = t_(f[iT.referencia]);
    if (ref in necesitoLM) (lineasPorLM[ref] = lineasPorLM[ref] || []).push(f);
  }
  if (iT.tienda === undefined) avisos.push('TOM no trae la columna "Nº Tienda": el cotejo por LM no distingue tienda (más riesgo de pedidos dudosos).');

  const candidatos = (lm, uds, exigirUds) => (lineasPorLM[lm] || []).filter(f => {
    if (t_(f[iT.tipoLinea]).toUpperCase().indexOf('SERVICIO') !== -1) return false;
    if (exigirUds && _anqNum_(f[iT.cantidad]) !== uds) return false;
    if (iT.tienda !== undefined && codTienda && _anqNum_(f[iT.tienda]) !== codTienda) return false;
    return true;
  });
  const pyxisDe = c => _anqUniq_(c.map(f => t_(f[iT.pyxis])));

  // ---- Resolver el pedido (Pyxis) de cada línea ----
  lineas.forEach(l => {
    if (l.pyxMensaje) { l.pyxis = l.pyxMensaje; l.como = 'Mensaje del PDF'; }
    else {
      let c = candidatos(l.lm, l.uds, true);
      let como = 'TOM (LM + unidades)';
      let unidadesDistintas = false;
      if (!c.length) {                                 // sin coincidencia exacta de unidades: entrega parcial
        c = candidatos(l.lm, l.uds, false).filter(f => (t_(f[iT.pegase]) in pegDet));
        if (c.length) { como = 'TOM (LM, unidades distintas)'; unidadesDistintas = true; }
      } else {
        const conPeg = c.filter(f => (t_(f[iT.pegase]) in pegDet));
        if (conPeg.length) { c = conPeg; como = 'TOM (LM + unidades + Pegase del Detalle)'; }
      }
      let pyxs = pyxisDe(c);
      if (pyxs.length > 1) {
        const enDetalle = pyxs.filter(p => p in pyxDet);
        if (enDetalle.length) pyxs = enDetalle;
      }
      if (pyxs.length === 1) {
        l.pyxis = pyxs[0]; l.como = como;
        const f = c.filter(x => t_(x[iT.pyxis]) === pyxs[0])[0];
        l.pegase = t_(f[iT.pegase]);
        if (unidadesDistintas) l.aviso = 'LM ' + l.lm + ': TOM tiene ' + _anqNum_(f[iT.cantidad]) + ' uds y el palé ' + l.uds + ' (entrega parcial)';
      } else if (pyxs.length === 0) {
        l.aviso = 'LM ' + l.lm + ' x' + l.uds + ': no hay pedido en TOM para esta tienda';
      } else {
        l.aviso = 'LM ' + l.lm + ' x' + l.uds + ': varios pedidos posibles (' + pyxs.join(', ') + ')';
      }
    }
    if (l.pyxis) {
      const f = candidatos(l.lm, l.uds, false).filter(x => t_(x[iT.pyxis]) === l.pyxis)[0];
      if (f) l.desc = t_(f[iT.descReferencia]);
      // Nº de pedido proveedor (Pegase) que lleva la etiqueta HODOS de tienda (Pedro, 2026-10-06): el de la línea
      // (tránsito: viene del Detalle/TOM) y, si no lo tiene (stock, resuelto por el Mensaje del PDF), el que TOM
      // trae para ese Pyxis + LM. Va aparte de `pegase` (que sigue siendo el "Pedido" de la hoja TOP y de RETENIDOS).
      l.pegaseProv = l.pegase || (f ? t_(f[iT.pegase]) : '');
    }
  });

  // ---- Proveedor de cada línea ----
  // STOCK (preparado en Antequera): el proveedor es el propio almacén, 493.
  // TRÁNSITO: el proveedor es el de la columna ENTREGA del Detalle, localizado por el Pegase del
  // pedido (el de TOM); si la línea no lo tiene, el de otra línea del mismo palé; si no hay, vacío.
  lineas.forEach(l => {
    if (l.esStock) { l.proveedor = ANQ_PROVEEDOR_STOCK; return; }
    const d = (porPegase[l.pegase] || []).filter(x => x.entrega)[0];
    if (d) l.proveedor = _anqProveedor_(d.entrega);
  });
  const provDePalet = {};
  lineas.forEach(l => { if (l.proveedor && !provDePalet[l.soporte]) provDePalet[l.soporte] = l.proveedor; });
  lineas.forEach(l => {
    if (l.proveedor) return;
    if (provDePalet[l.soporte]) { l.proveedor = provDePalet[l.soporte]; return; }
    const dc = porContenido[l.soporte];
    if (dc && dc.entrega) l.proveedor = _anqProveedor_(dc.entrega);
  });

  // ---- Unidades: lo que TRAE el palé (Resumen) frente a lo que PIDE el pedido (TOM) ----
  // Se compara por pedido + LM en toda la expedición (no por palé). Si trae MÁS de lo que pide, el
  // exceso es SOBRANTE: no corresponde a ningún pedido y lleva su propia etiqueta HODOS. Si trae menos
  // solo se avisa (puede ser una entrega parcial). El resultado se apunta en la ÚLTIMA línea del grupo.
  const claveUds = l => l.pyxis + '|' + l.lm;
  const pedidasTOM = {};
  lineas.forEach(l => {
    if (!l.pyxis) return;
    const k = claveUds(l);
    if (k in pedidasTOM) return;
    let tot = 0, hay = false;
    (lineasPorLM[l.lm] || []).forEach(f => {
      if (t_(f[iT.pyxis]) !== l.pyxis || t_(f[iT.tipoLinea]).toUpperCase().indexOf('SERVICIO') !== -1) return;
      tot += _anqNum_(f[iT.cantidad]); hay = true;
    });
    pedidasTOM[k] = hay ? tot : null;
  });
  const traenPorClave = {}, ultimaLinea = {};
  lineas.forEach((l, i) => { if (!l.pyxis) return; const k = claveUds(l); traenPorClave[k] = (traenPorClave[k] || 0) + l.uds; ultimaLinea[k] = i; });
  const r2 = n => Math.round(n * 100) / 100;
  lineas.forEach((l, i) => {
    if (!l.pyxis) return;
    const k = claveUds(l), pide = pedidasTOM[k];
    l.pide = pide;
    if (pide == null || ultimaLinea[k] !== i) return;
    const dif = r2(traenPorClave[k] - pide);
    if (dif > 0) l.sobra = dif; else if (dif < 0) l.falta = -dif;
    l.traeTotal = r2(traenPorClave[k]);
  });

  // ---- Agrupar por palé y decidir ----
  const bultosPorSop = {};
  if (bultos && bultos.soportes) bultos.soportes.forEach(b => { bultosPorSop[t_(b.soporte)] = b; });
  const palets = [], porSop = {};
  lineas.forEach(l => {
    let p = porSop[l.soporte];
    if (!p) {
      const b = bultosPorSop[l.soporte] || {};
      p = porSop[l.soporte] = {
        soporte: l.soporte, flujoDoc: l.esStock ? 'STOCK' : 'TRÁNSITO', tipo: t_(b.tipo), seccion: t_(b.seccion),
        lineas: [], pyx: [], cc2: {}, sinResolver: [], avisos: []
      };
      palets.push(p);
    }
    if (l.esStock !== (p.flujoDoc === 'STOCK')) p.flujoDoc = 'MIXTO';
    p.lineas.push(l);
    if (l.pyxis) { if (p.pyx.indexOf(l.pyxis) === -1) p.pyx.push(l.pyxis); if (l.flujo === 'CC2') p.cc2[l.pyxis] = true; }
    else p.sinResolver.push(l.aviso || ('LM ' + l.lm + ': sin pedido'));
    if (l.pyxis && l.aviso) p.avisos.push(l.aviso);
    if (l.sobra) p.avisos.push('SOBRANTE · LM ' + l.lm + ' del pedido ' + l.pyxis + ': trae ' + l.traeTotal + ' y pide ' + l.pide + ' -> sobran ' + l.sobra + ' uds (etiqueta HODOS de sobrante)');
    if (l.falta) p.avisos.push('Faltan ' + l.falta + ' uds de LM ' + l.lm + ' del pedido ' + l.pyxis + ' (trae ' + l.traeTotal + ', pide ' + l.pide + '; puede ser entrega parcial)');
  });

  const esMalaga = tienda === 'Málaga';
  if (esMalaga && !ceramica) avisos.push('Sin catálogo de cerámica (hoja CERAMICA): en Málaga se asume que TODO es cerámica y todo palé con varios pedidos se divide por pedido.');
  const resumenFinal = { palets: palets.length, retener: 0, etiqueta: 0, mixtos: 0, revisar: 0, pedidosRetener: 0, dividir: 0,
    sobrantes: lineas.filter(l => l.sobra).length, udsSobrantes: r2(lineas.reduce((a, l) => a + (l.sobra || 0), 0)), faltas: lineas.filter(l => l.falta).length };
  palets.forEach(p => {
    const retener = [], etiqueta = [];
    p.pyx.forEach(py => {
      const tr = transporte[py];
      const estado = tr === undefined ? '?' : (tr === 'SI' ? 'SI' : (tr === 'NO' ? 'NO' : '?'));
      p.pedidos = p.pedidos || [];
      p.pedidos.push({ pyxis: py, transporte: estado });
      if (estado === 'SI' && !p.cc2[py]) retener.push(py); else etiqueta.push(py);
      if (estado === '?') p.avisos.push('Pedido ' + py + ': no se puede confirmar el transporte en TOM (se etiqueta por defecto)');
      if (estado === 'SI' && p.cc2[py]) p.avisos.push('Pedido ' + py + ' es CC2: nunca se retiene, va con etiqueta');
    });
    p.pedidos = p.pedidos || [];
    p.retener = retener; p.etiqueta = etiqueta;
    p.textoEtiqueta = etiqueta.join('+');
    // Málaga + cerámica + varios pedidos: un soporte por pedido (no hay agrupación de cerámica en Málaga)
    p.dividir = esMalaga && p.pyx.length > 1 && (!ceramica || p.lineas.some(l => String(l.lm) in ceramica));
    if (p.dividir) {
      resumenFinal.dividir++;
      p.avisos.push('CERÁMICA MÁLAGA · un soporte por pedido: dividir este palé en ' + p.pyx.length + ' soportes (' + p.pyx.join(' · ') + ')' +
        (etiqueta.length ? '; etiqueta HODOS individual para ' + etiqueta.join(' · ') : '') + (retener.length ? '; ' + retener.join(' · ') + ' se retiene' : ''));
    }
    p.revisar = p.sinResolver.length > 0;
    p.accion = !p.pyx.length ? 'REVISAR' : (retener.length && etiqueta.length ? 'MIXTO' : (retener.length ? 'RETENER' : 'ETIQUETA'));
    // Detalle: contenidos (solo informativo) y proveedor(es) del palé
    const pegs = _anqUniq_(p.lineas.map(l => l.pegase));
    const conts = [];
    pegs.forEach(g => (porPegase[g] || []).forEach(d => { if (conts.indexOf(d.contenido) === -1) conts.push(d.contenido); }));
    if (porContenido[p.soporte] && conts.indexOf(p.soporte) === -1) conts.push(p.soporte);
    p.contenidosDetalle = conts; p.proveedor = _anqUniq_(p.lineas.map(l => l.proveedor)).join(' / ');
    if (p.accion === 'RETENER') { resumenFinal.retener++; resumenFinal.pedidosRetener += retener.length; }
    else if (p.accion === 'ETIQUETA') resumenFinal.etiqueta++;
    else if (p.accion === 'MIXTO') { resumenFinal.mixtos++; resumenFinal.pedidosRetener += retener.length; }
    if (p.revisar || p.accion === 'REVISAR') resumenFinal.revisar++;
    if (p.sinResolver.length) p.avisos = p.avisos.concat(p.sinResolver.map(s => 'SIN PEDIDO · ' + s));
  });

  // ---- Cuadre entre los 3 PDF ----
  const expDet = _anqUniq_(lineas.map(l => l.exp))[0] || '';
  const cuadre = { hayBultos: !!bultos, soportesResumen: palets.length, soportesBultos: null, palesDeclarados: null, bultosDeclarados: null,
    palesContados: null, bultosContados: null, faltanEnResumen: [], sobranEnResumen: [], detalleVivas: detalleVivas };
  if (bultos) {
    const sopB = (bultos.soportes || []).map(b => t_(b.soporte)).filter(s => !yaEntregado[s]);
    cuadre.soportesBultos = sopB.length;
    cuadre.palesDeclarados = bultos.palets == null ? null : Number(bultos.palets);
    cuadre.bultosDeclarados = bultos.bultos == null ? null : Number(bultos.bultos);
    cuadre.palesContados = (bultos.soportes || []).filter(b => /^P/i.test(t_(b.tipo))).length;
    cuadre.bultosContados = (bultos.soportes || []).filter(b => /^C/i.test(t_(b.tipo))).length;
    sopB.forEach(s => { if (!porSop[s]) cuadre.faltanEnResumen.push(s); });
    palets.forEach(p => { if (sopB.indexOf(p.soporte) === -1) cuadre.sobranEnResumen.push(p.soporte); });
    if (cuadre.faltanEnResumen.length) avisos.push('Soportes de Bultos que NO están en el Resumen: ' + cuadre.faltanEnResumen.join(', ') + ' (¿falta una hoja del Resumen?)');
    if (cuadre.sobranEnResumen.length) avisos.push('Soportes del Resumen que NO están en Bultos: ' + cuadre.sobranEnResumen.join(', '));
    if (cuadre.palesDeclarados != null && cuadre.palesContados !== cuadre.palesDeclarados) avisos.push('Bultos declara ' + cuadre.palesDeclarados + ' palés pero lista ' + cuadre.palesContados + '.');
    if (cuadre.bultosDeclarados != null && cuadre.bultosContados !== cuadre.bultosDeclarados) avisos.push('Bultos declara ' + cuadre.bultosDeclarados + ' bultos pero lista ' + cuadre.bultosContados + '.');
    if (E.exp && bultos.exp && String(bultos.exp).replace(/^0+/, '') !== String(E.exp).replace(/^0+/, '')) avisos.push('La expedición de Bultos (' + bultos.exp + ') no coincide con la del Resumen (' + E.exp + ').');
  } else {
    avisos.push('Sin PDF de Bultos: no se puede comprobar que lleguen todos los palés (súbelo también).');
  }
  if (E.exp && expDet && String(E.exp).replace(/^0+/, '') !== expDet) avisos.push('La expedición del Detalle (' + E.exp + ') no coincide con la del Resumen (' + expDet + ').');
  if (detalle.length && cuadre.soportesBultos != null && detalleVivas !== cuadre.soportesBultos) {
    avisos.push('El Detalle trae ' + detalleVivas + ' contenidos y Bultos ' + cuadre.soportesBultos + ' soportes (pueden ser palés consolidados; revisa).');
  }

  // ---- Líneas para TOP ----
  const exp = String(E.exp || expDet || '').replace(/^0+/, '');
  const top = lineas.map(l => ({
    origen: 'Antequera', exp: exp, tienda: tienda,
    pegase: l.pegase, pyxis: l.pyxis, flujo: l.flujo, soporte: l.soporte,
    lmRaw: l.lmRaw, uds: l.uds, ean: l.ean, proveedor: l.proveedor, desc: l.desc,
    tiendaNum: ('000' + codTienda).slice(-3),
    pide: l.pide == null ? '' : l.pide, dif: l.sobra ? l.sobra : (l.falta ? -l.falta : ''),
    pegaseProv: l.pegaseProv || ''
  }));

  return {
    ok: true, exp: exp, tienda: tienda, camion: bultos ? { transportista: bultos.transportista || '', matricula: bultos.matricula || '',
      remolque: bultos.remolque || '', precinto: bultos.precinto || '', peso: bultos.peso || '' } : null,
    cuadre: cuadre, avisos: avisos, resumen: resumenFinal, palets: palets.map(p => ({
      soporte: p.soporte, flujoDoc: p.flujoDoc, tipo: p.tipo, seccion: p.seccion, proveedor: p.proveedor || '', contenidosDetalle: p.contenidosDetalle,
      lineas: p.lineas.map(l => ({ lm: l.lm, uds: l.uds, ean: l.ean, proveedor: l.proveedor, pyxis: l.pyxis, como: l.como, pide: l.pide, sobra: l.sobra, falta: l.falta, traeTotal: l.traeTotal })),
      pedidos: p.pedidos, accion: p.accion, retener: p.retener, etiqueta: p.etiqueta, textoEtiqueta: p.textoEtiqueta, dividir: !!p.dividir,
      revisar: p.revisar, avisos: p.avisos
    })), top: top
  };
}
