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
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
  return _anqAnalizar_(entrada, tomDatos);
}

/**
 * Análisis puro (sin Sheets ni Drive): se prueba en Node con TOM real.
 * tomDatos = { filas, iTOM } (filas[0] = cabecera). iTOM.tienda es opcional.
 */
function _anqAnalizar_(entrada, tomDatos) {
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
      lmRaw: lmRaw, lm: _anqLm_(lmRaw), uds: _anqNum_(r.unidades),
      pyxMensaje: m ? m[1] : '', exp: t_(r.exp).replace(/^0+/, ''), cliente: t_(r.cliente),
      pyxis: '', pegase: '', como: '', desc: '', aviso: ''
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
    }
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
  });

  const resumenFinal = { palets: palets.length, retener: 0, etiqueta: 0, mixtos: 0, revisar: 0, pedidosRetener: 0 };
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
    p.revisar = p.sinResolver.length > 0;
    p.accion = !p.pyx.length ? 'REVISAR' : (retener.length && etiqueta.length ? 'MIXTO' : (retener.length ? 'RETENER' : 'ETIQUETA'));
    // Detalle: proveedor y contenidos (solo informativo)
    const pegs = _anqUniq_(p.lineas.map(l => l.pegase));
    const conts = [];
    let prov = '';
    pegs.forEach(g => (porPegase[g] || []).forEach(d => { if (conts.indexOf(d.contenido) === -1) conts.push(d.contenido); if (!prov && d.entrega) prov = d.entrega; }));
    if (porContenido[p.soporte]) { prov = prov || porContenido[p.soporte].entrega; if (conts.indexOf(p.soporte) === -1) conts.push(p.soporte); }
    p.contenidosDetalle = conts; p.proveedor = prov;
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
    lmRaw: l.lmRaw, uds: l.uds, desc: l.desc
  }));

  return {
    ok: true, exp: exp, tienda: tienda, camion: bultos ? { transportista: bultos.transportista || '', matricula: bultos.matricula || '',
      remolque: bultos.remolque || '', precinto: bultos.precinto || '', peso: bultos.peso || '' } : null,
    cuadre: cuadre, avisos: avisos, resumen: resumenFinal, palets: palets.map(p => ({
      soporte: p.soporte, flujoDoc: p.flujoDoc, tipo: p.tipo, seccion: p.seccion, proveedor: p.proveedor || '', contenidosDetalle: p.contenidosDetalle,
      lineas: p.lineas.map(l => ({ lm: l.lm, uds: l.uds, pyxis: l.pyxis, como: l.como })),
      pedidos: p.pedidos, accion: p.accion, retener: p.retener, etiqueta: p.etiqueta, textoEtiqueta: p.textoEtiqueta,
      revisar: p.revisar, avisos: p.avisos
    })), top: top
  };
}
