/**
 * BORRAR CONTENIDO (manual)
 * Tú preparas las hojas para el día siguiente, así que NO hay borrado
 * automático: un solo botón borra todo el contenido cuando tú quieras.
 * Se conservan los datos maestros (EAN y FAMILIAS TIENDA).
 */

/**
 * Limpieza TOTAL de una hoja: contenido + formato + notas + validaciones, y
 * DESOCULTA filas y columnas. Así no quedan columnas ocultas ni formatos viejos.
 */
function _limpiarHojaFull_(ws) {
  if (!ws) return;
  const maxR = ws.getMaxRows(), maxC = ws.getMaxColumns();
  ws.clearContents();
  ws.clearFormats();
  ws.clearNotes();
  if (maxR > 0 && maxC > 0) ws.getRange(1, 1, maxR, maxC).clearDataValidations();
  if (maxC > 0) ws.showColumns(1, maxC);
  if (maxR > 0) ws.showRows(1, maxR);
}

/** Borra el contenido de trabajo + el registro de retenidos (todo, a fondo) */
function borrarTodo() {
  const ss = SpreadsheetApp.getActive();

  CFG.RESET_TOTAL.concat(CFG.RESET_CONTENIDO).forEach(n => _limpiarHojaFull_(ss.getSheetByName(n)));

  // RETENIDOS NO se toca: se conservan los pedidos retenidos.

  ss.toast('Contenido del día borrado. RETENIDOS, EAN y FAMILIAS TIENDA se conservan.', '🧹 Borrar', 6);
}

/** Borra SOLO la hoja TOP (contenido + formato + desocultar) */
function borrarTOP() {
  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(CFG.HOJAS.TOP);
  if (!ws) { ss.toast('No encuentro la hoja TOP.', '🧹 Borrar TOP', 5); return; }
  _limpiarHojaFull_(ws);
  ss.toast('Hoja TOP borrada.', '🧹 Borrar TOP', 4);
}

/** Borrar todo con confirmación (menú / panel) */
function borrarTodoMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Borrar todo',
      '¿Borrar TOP y TRAMECO?\n' +
      '(RETENIDOS, EAN y FAMILIAS TIENDA se conservan. TOM ya no es una hoja: se lee de Drive.)',
      ui.ButtonSet.YES_NO) === ui.Button.YES) {
    borrarTodo();
  }
}

/** Borrar solo TOP con confirmación (menú / panel) */
function borrarTOPMenu() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Borrar TOP', '¿Borrar todo el contenido de la hoja TOP?',
      ui.ButtonSet.YES_NO) === ui.Button.YES) {
    borrarTOP();
  }
}
