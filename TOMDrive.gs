/**
 * TOM DESDE DRIVE (cotejo)
 *
 * TOM ya no es una hoja donde se pega el CSV a mano: se lee directo desde
 * Drive en cada pasada. Pedro no necesita ver ni tocar TOM — solo se usa
 * para cotejar contra TOP (transporte, LM, cantidad...). Carpeta fija; se usa
 * SIEMPRE el CSV más reciente que haya en ella, esté o no actualizado hoy.
 *
 * Las columnas se localizan por CABECERA, no por posición fija — así aguanta
 * que Leroy Merlin reordene el export sin tocar código (ver _indicesTOM_ en Menu.gs).
 *
 * 2026-10-07/08 — «TOM (Drive): no encuentro en la cabecera estas columnas: pyxis, transporte, referencia, …»
 * (las 7 a la vez, macro parado). CAUSA REAL (confirmada con la muestra del archivo de las 19:08 del 07/10):
 * el CSV pasó a ser el informe «Pedidos Vivos con líneas»: delante de la cabecera lleva una LÍNEA DE TÍTULO
 * («Pedidos Vivos con lineas:fecha entre 2025-09-01 y 2026-10-07, tienda: ('14','36','279'), …») y una línea en
 * blanco, y la cabecera trae 124 columnas (las 110 de siempre + 14 «Infolog»). La lectura daba por hecho que la
 * cabecera era la primera fila. El archivo del robot (110 columnas, sin título) sigue siendo válido: se aceptan
 * los dos formatos. Además se endureció la lectura (otra codificación, separador, cabecera en las primeras filas,
 * nombres normalizados) y, si algún día nada sirve, el error DICE QUÉ HA LEÍDO para diagnosticarlo sin adivinar.
 * Si el formato de siempre funciona, el resultado es exactamente el de antes.
 */

const TOM_DRIVE_CARPETA_ID = '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG';
const TOM_DRIVE_ARCHIVO = 'Pedidos_Totales.csv';
/** Tiendas que operamos: código de TOM («Nº Tienda») -> nombre. */
const TOM_NOMBRE_TIENDA = { '36': 'Málaga', '14': 'Marbella', '279': 'Mijas', '43': 'Granada' };
/** Si el TOM usado tiene más de estas horas, se avisa (se usa igualmente: Pedro prefiere el último que haya a parar). */
const TOM_DRIVE_HORAS_AVISO = 6;

/** Columnas que TODOS los procesos necesitan como mínimo para funcionar. */
const TOM_DRIVE_COLUMNAS_MINIMAS = ['pyxis', 'transporte', 'referencia', 'descReferencia', 'tipoLinea', 'cantidad', 'pegase'];

/**
 * Separador del CSV: el que MÁS veces aparece en una línea de las primeras (la cabecera y las filas de datos
 * llevan más de 100; una línea de título suelta con comas, no). Empate o nada claro -> ';' como siempre.
 */
function _detectarSeparadorTOM_(texto) {
  const lineas = [];
  let desde = 0;
  while (lineas.length < 40 && desde < texto.length) {
    let hasta = texto.indexOf('\n', desde);
    if (hasta < 0) hasta = texto.length;
    const l = texto.substring(desde, Math.min(hasta, desde + 20000));
    if (l.trim() !== '') lineas.push(l);
    desde = hasta + 1;
  }
  let mejor = ';', max = 0;
  [';', ',', '\t'].forEach(d => {
    let m = 0;
    lineas.forEach(l => { m = Math.max(m, l.split(d).length - 1); });
    if (m > max) { max = m; mejor = d; }
  });
  return max >= 2 ? mejor : ';';
}

/**
 * Convierte el texto del CSV de TOM en filas, o describe por qué no puede.
 * Devuelve { filas, iTOM, delim, filaCabecera } si están TODAS las columnas mínimas; si no,
 * { faltan, diag } con lo que se ha visto (para el mensaje de error). filas[0] es SIEMPRE la cabecera
 * (si el archivo trae título o líneas en blanco delante, se descartan).
 * Pura (sin Drive): se prueba en Node.
 */
function _parsearTOMTexto_(texto, delimForzado) {
  // El export de Leroy Merlin junta varios trozos de ~10.000 filas cada uno
  // SIN salto de línea entre ellos, y cada trozo lleva su propio BOM al
  // principio (confirmado: BOM en los límites 10.000/20.000/30.000 filas, Y
  // el arranque del archivo trae DOS BOM seguidos — un trozo inicial vacío).
  // Cada BOM (U+FEFF) es la costura entre dos trozos -> se convierte en
  // salto de línea real, sean cuantos sean y esté donde esté (incluida la
  // posición 0). Sin este arreglo, Utilities.parseCsv falla con "No se ha
  // podido analizar el texto" para el archivo COMPLETO (no solo esas
  // filas): un único BOM perdido descuadra el parseo desde ahí en adelante.
  const BOM = String.fromCharCode(0xFEFF);
  texto = String(texto == null ? '' : texto).split(BOM).join('\n');

  const delim = delimForzado || _detectarSeparadorTOM_(texto);

  let filas;
  try {
    filas = Utilities.parseCsv(texto, delim);
  } catch (e) {
    return { faltan: TOM_DRIVE_COLUMNAS_MINIMAS.slice(), diag: 'no se puede leer como CSV (' + e.message + ')', delim: delim };
  }
  // Las BOM seguidas al principio dejan "filas" en blanco antes de la
  // cabecera real (una línea vacía entre cada costura consecutiva) -> se saltan.
  while (filas.length && filas[0].every(c => t_(c) === '')) filas.shift();
  if (!filas.length) return { faltan: TOM_DRIVE_COLUMNAS_MINIMAS.slice(), diag: 'el archivo está vacío', delim: delim };

  // La cabecera suele ser la primera fila; si no (línea de título del informe «Pedidos Vivos», líneas en
  // blanco...), se busca en las primeras y se descarta lo de antes.
  let mejor = null;
  for (let k = 0; k < Math.min(filas.length, 40); k++) {
    const iTOM = _indicesTOM_(filas[k]);
    const faltan = TOM_DRIVE_COLUMNAS_MINIMAS.filter(c => iTOM[c] === undefined);
    if (!mejor || faltan.length < mejor.faltan.length) mejor = { k: k, iTOM: iTOM, faltan: faltan };
    if (!faltan.length) break;
  }
  if (mejor.faltan.length) {
    const cab = filas[0].slice(0, 8).map(c => t_(c).substring(0, 60));
    const cod = t_(filas[0][0]).substring(0, 4).split('').map(ch => ch.charCodeAt(0).toString(16)).join(' ');
    return {
      faltan: mejor.faltan,
      delim: delim,
      diag: filas.length + ' filas, ' + filas[0].length + ' columnas, separador ' + (delim === '\t' ? 'TAB' : '"' + delim + '"') +
        ', 1ª fila: ' + JSON.stringify(cab) + (filas[0].length > 8 ? '…' : '') + ' (1ª celda en hex: ' + cod + ')'
    };
  }
  if (mejor.k > 0) filas = filas.slice(mejor.k);
  return { filas: filas, iTOM: mejor.iTOM, delim: delim, filaCabecera: mejor.k };
}

/**
 * CSV de TOM de la carpeta, el MÁS RECIENTE primero (por fecha de modificación): se usa el último que haya, esté
 * o no actualizado hoy, y se llame como se llame (el robot lo sube «pedidos_totales.csv»; una subida a mano puede
 * llevar otro nombre, p. ej. «pedidos_totales (1).csv»). El CSV «_2» (otro informe, ~100 MB, lo lee INCPC) no se
 * usa: es de otra consulta y no cabe en memoria.
 */
function _archivosTOMDrive_(carpeta) {
  const lista = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const nombre = f.getName();
    if (!/\.csv$/i.test(nombre) && f.getMimeType() !== MimeType.CSV) continue;   // los .xlsx de inventario de las tiendas no
    if (/_2(\.| \()/i.test(nombre)) continue;                                      // pedidos_totales_2.csv
    lista.push(f);
  }
  lista.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
  return lista;
}

/**
 * Lee y parsea el CSV de TOM desde Drive.
 * Devuelve { filas, iTOM, fuente } si todo va bien (filas[0] = cabecera, incluida; fuente = { nombre, actualizado,
 * horas } del archivo usado, para avisar si no está al día); o { error } con un mensaje ya listo para toast si
 * algo falla (carpeta o archivo no encontrado, o faltan columnas esperadas en la cabecera).
 */
function _leerTOMDesdeDrive_() {
  let archivos;
  try {
    archivos = _archivosTOMDrive_(DriveApp.getFolderById(TOM_DRIVE_CARPETA_ID));
  } catch (e) {
    return { error: 'TOM (Drive): no puedo acceder a la carpeta (' + e.message + ').' };
  }
  if (!archivos.length) {
    return { error: 'TOM (Drive): no encuentro "' + TOM_DRIVE_ARCHIVO + '" en la carpeta (ni ningún otro CSV de TOM).' };
  }

  const problemas = [];
  for (let n = 0; n < archivos.length; n++) {
    const archivo = archivos[n];
    const fecha = archivo.getLastUpdated();
    const nombre = archivo.getName() + ' (' + archivo.getSize() + ' bytes, ' + Utilities.formatDate(fecha, 'Europe/Madrid', 'dd/MM HH:mm') + ')';
    let blob;
    try {
      blob = archivo.getBlob();
    } catch (e) {
      problemas.push({ faltan: null, texto: nombre + ': no puedo leerlo (' + e.message + ')' });
      continue;
    }
    // Camino de siempre: UTF-8. Si no sale, otras codificaciones (el robot o TOM pueden cambiarla).
    const codificaciones = ['UTF-8', 'UTF-16', 'ISO-8859-1'];
    let ultimo = null;
    for (let c = 0; c < codificaciones.length; c++) {
      let texto;
      try {
        texto = blob.getDataAsString(codificaciones[c]);
      } catch (e) {
        ultimo = { diag: 'no se puede decodificar como ' + codificaciones[c] + ' (' + e.message + ')' };
        continue;
      }
      const r = _parsearTOMTexto_(texto);
      if (r.filas) {
        return {
          filas: r.filas, iTOM: r.iTOM,
          fuente: {
            nombre: archivo.getName(),
            actualizado: Utilities.formatDate(fecha, 'Europe/Madrid', 'dd/MM HH:mm'),
            horas: Math.max(0, Math.floor((new Date().getTime() - fecha.getTime()) / 3600000)),
            tiendas: _tiendasEnTOM_(r.filas, r.iTOM),   // ['14','36','279'] (el export manual) o ['14','36','43','279'] (el del robot)
            posicion: n   // 0 = el más reciente; >0 = hubo que saltarse archivos más nuevos que no servían
          }
        };
      }
      ultimo = r;
      ultimo.codificacion = codificaciones[c];
      if (c === 0 && /no se puede leer como CSV/.test(r.diag || '')) break;   // un fallo de formato no se arregla cambiando de codificación
    }
    problemas.push({ faltan: (ultimo && ultimo.faltan) || null,
      texto: 'Archivo leído: ' + nombre + ' — ' + (ultimo && ultimo.diag ? ultimo.diag : 'sin detalle') + (ultimo && ultimo.codificacion ? ' [' + ultimo.codificacion + ']' : '') });
  }
  const p0 = problemas[0];
  return { error: 'TOM (Drive): ' + (p0.faltan ? 'no encuentro en la cabecera estas columnas: ' + p0.faltan.join(', ') + '. ' : 'no se pudo leer. ') + p0.texto +
    (problemas.length > 1 ? ' | Otros archivos: ' + problemas.slice(1).map(p => p.texto).join(' | ') : '') };
}

/** Códigos de tienda ('36', '14'…) con pedidos en el TOM, o null si no se sabe (el CSV no trae la columna «Nº Tienda»). */
function _tiendasEnTOM_(filas, iTOM) {
  if (iTOM.tienda === undefined) return null;
  const set = {};
  for (let i = 1; i < filas.length; i++) {
    const v = filas[i][iTOM.tienda];
    if (v === undefined) continue;
    const s = String(v).replace(/[^0-9]/g, '');     // "036" / "36" / "E036" -> 36
    if (s !== '' && s.length <= 4) set[String(parseInt(s, 10))] = true;
  }
  return Object.keys(set).sort((a, b) => a - b);
}

/**
 * Código de TOM de una tienda por su nombre ("Málaga", "MARBELLA"…, con o sin tilde); '' si no es una de las nuestras.
 */
function _codigoTOMdeTienda_(nombre) {
  const n = t_(nombre).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cods = Object.keys(TOM_NOMBRE_TIENDA);
  for (let i = 0; i < cods.length; i++) {
    if (TOM_NOMBRE_TIENDA[cods[i]].toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === n) return cods[i];
  }
  return '';
}

/**
 * Aviso si el TOM usado NO trae pedidos de alguna de las tiendas que el proceso necesita. Caso real: el export manual
 * «Pedidos Vivos» (07/10) solo lleva las tiendas 14, 36 y 279, SIN Granada (43), mientras que el del robot las trae todas;
 * con él, los pedidos de Granada en Recepción no se cotejaban ni se retenían y no se decía nada. `codigos` = códigos que el
 * proceso va a necesitar ('36', '043'…). Sin dato de tiendas en el TOM -> sin aviso (no se sabe).
 */
function _avisoTOMSinTiendas_(tomDatos, codigos) {
  const f = tomDatos && tomDatos.fuente;
  if (!f || !f.tiendas) return '';
  const faltan = [];
  (codigos || []).forEach(c => {
    const k = String(parseInt(String(c).replace(/[^0-9]/g, ''), 10));
    if (k !== 'NaN' && f.tiendas.indexOf(k) === -1 && faltan.indexOf(k) === -1) faltan.push(k);
  });
  if (!faltan.length) return '';
  return 'El TOM usado (' + f.nombre + ') NO trae pedidos de ' +
    faltan.map(k => TOM_NOMBRE_TIENDA[k] ? TOM_NOMBRE_TIENDA[k] + ' (' + k + ')' : 'la tienda ' + k).join(' ni de ') +
    ': esos pedidos no se pueden cotejar y no se retendrán por transporte. Sube un TOM que incluya esa tienda (el del robot las trae todas)';
}

/** Texto de aviso si el TOM usado no está al día (o hubo que usar uno anterior); '' si todo está bien. */
function _avisoTOMAntiguo_(tomDatos) {
  const f = tomDatos && tomDatos.fuente;
  if (!f) return '';
  if (f.horas < TOM_DRIVE_HORAS_AVISO && !f.posicion) return '';
  const porque = f.posicion
    ? ', porque ' + (f.posicion === 1 ? 'el archivo más reciente no se pudo leer' : 'los ' + f.posicion + ' archivos más recientes no se pudieron leer')
    : '';
  return 'TOM sin actualizar: se usa ' + f.nombre + ' del ' + f.actualizado + ' (hace ' + f.horas + ' h)' + porque;
}
