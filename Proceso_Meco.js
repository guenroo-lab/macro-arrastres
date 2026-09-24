/**
 * PROCESO MECO  (solo formato visual)
 * NO hace cotejo: los pedidos de esta hoja ya tienen gastos de envío.
 * Ordena todas las filas por pedido (col P), renombra cabeceras, aplica color
 * por pedido, oculta columnas y fija fecha/hora en V1:V4.
 *
 * fecha y hora se pasan como parámetros (desde el panel o el menú).
 */
function procesarMeco(fecha, hora) {
  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);

  const uTOP = ultimaFilaCol_(wsTOP, 16); // P
  if (uTOP < 2) { ss.toast('La hoja TOP no tiene datos.', '🚛 Meco', 5); return 'TOP vacía.'; }

  // Solo A..U (21 col). La columna V NO se lee ni se reescribe con los datos:
  // guarda el bloque de información (V1:V4). Si se incluyera, en la 2ª pasada
  // las filas 2-4 traerían 'Meco'/fecha/hora en V, se ordenarían con el resto y
  // acabarían esparcidas por filas aleatorias — basura que crece en cada pasada.
  const N = 21;
  const top = wsTOP.getRange(1, 1, uTOP, N).getValues();
  const cP = 15;

  // OJO: la columna A NO se toca. Es el número de Optimus (referencia de
  // envío) y la carátula lo necesita tal cual (ver _datosCaratula_ en
  // Impresion.gs). El origen "Meco" para la carátula sale del bloque de
  // información V1:V4 (V2='Meco'), no de traducir esta columna.

  // Cabeceras
  const cab = top[0];
  cab[2]='Flete'; cab[5]='Tienda'; cab[7]='Pedido'; cab[10]='LM';
  cab[11]='Articulo'; cab[12]='EAN'; cab[13]='Cantidad'; cab[15]='Pyxis';

  // Ordenar TODAS las filas por el pedido Pyxis (col P) — sin cotejo, todas se
  // formatean. Orden numérico cuando ambos valores son números (2 < 10 < 100);
  // si no, alfabético.
  const idx = [];
  for (let i = 1; i < uTOP; i++) idx.push(i);
  idx.sort((a, b) => _cmpPyxis_(top[a][cP], top[b][cP]));

  const filasFinal = [cab];
  idx.forEach(i => filasFinal.push(top[i]));

  // Backgrounds A:T (20 col), alternando color por pedido (P)
  const ANCHO = 20;
  const fondos = [];
  let pedAnt = '', alt = false;
  for (let f = 1; f < filasFinal.length; f++) {
    const p = String(filasFinal[f][cP]);
    if (p !== pedAnt) { alt = !alt; pedAnt = p; }
    fondos.push(new Array(ANCHO).fill(alt ? CFG.COLORES.VERDE_CLARO : CFG.COLORES.VERDE_OSCURO));
  }

  // Escritura por bloques
  for (let r = 1; r < filasFinal.length; r++) filasFinal[r][10] = _lmNum_(filasFinal[r][10]); // LM (col K) entero
  wsTOP.getRange(1, 1, filasFinal.length, N).setValues(filasFinal);
  wsTOP.getRange(2, 1, fondos.length, ANCHO).setBackgrounds(fondos);
  wsTOP.getRange(1, 1, 1, N).setFontWeight('bold').setBackground(CFG.COLORES.GRIS_TITULO);
  wsTOP.getRange(1, 1, filasFinal.length, ANCHO).setBorder(true, true, true, true, true, true);
  wsTOP.getRange(2, 11, fondos.length, 1).setNumberFormat('0'); // K (LM): entero sin decimales
  autoajustar_(wsTOP, 1, ANCHO);
  [1, 4, 5, 7, 10, 21].forEach(c => wsTOP.hideColumns(c)); // A, D, E, G, J, U

  // Limpia restos del bloque info esparcidos por la columna V en pasadas
  // anteriores (antes V se ordenaba junto a los datos y dejaba basura suelta).
  if (uTOP > 4) wsTOP.getRange(5, 22, uTOP - 4, 1).clearContent();

  // Fecha y hora fijas en V1:V4
  wsTOP.getRange('V1:V4').setValues([['Información'], ['Meco'], [fecha], [hora]])
    .setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  const msg = `Meco con formato aplicado · ${idx.length} líneas · llegada ${fecha} ${hora}.`;
  ss.toast(msg, '🚛 Meco', 6);
  return msg;
}

/** Versión de menú: pide fecha y hora con diálogos y luego procesa */
function procesarMecoMenu() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  // Día siguiente con salto de fin de semana al lunes (misma regla que retenidos
  // y carátula), en vez de "hoy + 1" a secas que en viernes daba sábado.
  const def = _fechaEnvioPorOrigen_('Meco');

  let r = ui.prompt('Fecha de llegada', 'Introduce la fecha (por defecto ' + def + '):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  let fecha = t_(r.getResponseText()) || def;

  let hora = '';
  while (['6:00', '7:00', '8:00'].indexOf(hora) === -1) {
    r = ui.prompt('Hora de llegada', 'Elige entre 6:00, 7:00, 8:00:', ui.ButtonSet.OK);
    hora = t_(r.getResponseText()) || '6:00';
  }
  procesarMeco(fecha, hora);
}

/**
 * Compara dos valores de Pyxis para ordenar: numérico si ambos son números
 * (así 2 < 10 < 100), si no, alfabético. Los números van antes que los textos.
 */
function _cmpPyxis_(a, b) {
  const sa = t_(a), sb = t_(b);
  const na = Number(sa.replace(',', '.')), nb = Number(sb.replace(',', '.'));
  const aNum = sa !== '' && isFinite(na), bNum = sb !== '' && isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
