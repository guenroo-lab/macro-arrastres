/**
 * AUTOMATIZACIONES (disparadores de tiempo)
 *
 *   12:30 mediodía  -> importarRetenidosPortada  (agrega solos los retenidos de portada)
 *   03:00 madrugada -> borradoNocturno           (borra todo MENOS RETENIDOS;
 *                                                  de RETENIDOS quita solo lo ya Enviado)
 *
 * Se activan UNA vez con "Activar automatizaciones". Luego corren solos cada día.
 * Nota: Google dispara estos triggers dentro de una franja cercana a la hora
 * indicada (no al minuto exacto).
 */

function activarAutomatizaciones() {
  _quitarTriggers_();

  ScriptApp.newTrigger('importarRetenidosPortada')
    .timeBased().everyDays(1).atHour(12).nearMinute(30).create();

  ScriptApp.newTrigger('borradoNocturno')
    .timeBased().everyDays(1).atHour(3).create();

  ScriptApp.newTrigger('informeSemanal')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  ScriptApp.newTrigger('informeMensual')
    .timeBased().onMonthDay(1).atHour(7).create();

  SpreadsheetApp.getActive().toast(
    'Activadas: portada 12:30, borrado 3:00, informe semanal (lun) y mensual (día 1).', '⏰ Automatizaciones', 7);
  return 'ok';
}

function desactivarAutomatizaciones() {
  const n = _quitarTriggers_();
  SpreadsheetApp.getActive().toast(
    n ? ('Automatizaciones desactivadas (' + n + ').') : 'No había automatizaciones activas.',
    '⏹️ Automatizaciones', 5);
  return 'ok';
}

/** Borra los triggers de esta macro. Devuelve cuántos quitó. */
function _quitarTriggers_() {
  const fns = { importarRetenidosPortada: 1, borradoNocturno: 1, informeSemanal: 1, informeMensual: 1 };
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (fns[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

/**
 * Borrado nocturno (3:00): limpia las hojas de trabajo y deja RETENIDOS,
 * quitando de ella solo las filas marcadas como Enviado.
 */
function borradoNocturno() {
  const ss = SpreadsheetApp.getActive();

  CFG.RESET_TOTAL.concat(CFG.RESET_CONTENIDO).forEach(n => _limpiarHojaFull_(ss.getSheetByName(n)));

  limpiarEnviadosRetenidos_();
  ss.toast('Borrado nocturno hecho. RETENIDOS conserva lo no enviado.', '🌙 Borrado', 6);
}

/** Quita de RETENIDOS las filas ya enviadas (Enviado != ''), conservando el resto. */
function limpiarEnviadosRetenidos_() {
  const ws = SpreadsheetApp.getActive().getSheetByName(CFG.HOJAS.RETENIDOS);
  if (!ws) return;
  CFG.RETEN_BLOQUES.forEach(b => {
    const filas = _leerBloque_(ws, b);
    const quedan = filas.filter(r => t_(r[7]) === '');  // conserva NO enviados (Enviado = col 7)
    _escribirBloque_(ws, b, quedan);
  });
}
