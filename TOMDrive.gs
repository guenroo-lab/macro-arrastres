/**
 * TOM DESDE DRIVE (cotejo)
 *
 * TOM ya no es una hoja donde se pega el CSV a mano: se lee directo desde
 * Drive en cada pasada. Pedro no necesita ver ni tocar TOM — solo se usa
 * para cotejar contra TOP (transporte, LM, cantidad...). Carpeta y nombre
 * de archivo fijos; siempre se lee la última versión subida.
 *
 * Las columnas se localizan por CABECERA (fila 1 del CSV), no por posición
 * fija — así aguanta que Leroy Merlin reordene el export sin tocar código
 * (ver _indicesTOM_ en Menu.gs).
 *
 * 2026-10-07 — «TOM (Drive): no encuentro en la cabecera estas columnas…» con las 7 columnas a la vez y
 * el macro parado. La lectura era demasiado rígida: un solo camino (UTF-8, ';', cabecera en la primera
 * fila, nombres exactos) y un error sin pistas. Ahora, si el camino de siempre no encuentra las columnas,
 * se prueba lo razonable (otra codificación, otro separador, cabecera en otra fila, el archivo anterior si
 * el más reciente está a medias) y, si nada sirve, el error DICE QUÉ HA LEÍDO (archivo, tamaño, filas,
 * separador, cabecera) para poder diagnosticarlo sin adivinar. Si el camino de siempre funciona, el
 * resultado es exactamente el de antes.
 */

const TOM_DRIVE_CARPETA_ID = '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG';
const TOM_DRIVE_ARCHIVO = 'Pedidos_Totales.csv';

/** Columnas que TODOS los procesos necesitan como mínimo para funcionar. */
const TOM_DRIVE_COLUMNAS_MINIMAS = ['pyxis', 'transporte', 'referencia', 'descReferencia', 'tipoLinea', 'cantidad', 'pegase'];

/**
 * Convierte el texto del CSV de TOM en filas, o describe por qué no puede.
 * Devuelve { filas, iTOM, delim, filaCabecera } si están TODAS las columnas mínimas; si no,
 * { faltan, diag } con lo que se ha visto (para el mensaje de error).
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

  // Separador: ';' como siempre, salvo que la primera línea con contenido diga otra cosa.
  let delim = delimForzado || ';';
  if (!delimForzado) {
    const primera = (texto.split('\n').filter(l => l.trim() !== '')[0] || '').substring(0, 4000);
    const cuenta = { ';': primera.split(';').length, ',': primera.split(',').length, '\t': primera.split('\t').length };
    if (cuenta[';'] < 3) delim = cuenta['\t'] > cuenta[','] ? '\t' : (cuenta[','] >= 3 ? ',' : ';');
  }

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

  // La cabecera suele ser la primera fila; si no (líneas de título delante), se busca en las primeras.
  let mejor = null;
  for (let k = 0; k < Math.min(filas.length, 10); k++) {
    const iTOM = _indicesTOM_(filas[k]);
    const faltan = TOM_DRIVE_COLUMNAS_MINIMAS.filter(c => iTOM[c] === undefined);
    if (!mejor || faltan.length < mejor.faltan.length) mejor = { k: k, iTOM: iTOM, faltan: faltan };
    if (!faltan.length) break;
  }
  if (mejor.faltan.length) {
    const cab = filas[0].slice(0, 8).map(c => t_(c).substring(0, 28));
    const cod = t_(filas[0][0]).substring(0, 4).split('').map(ch => ch.charCodeAt(0).toString(16)).join(' ');
    return {
      faltan: mejor.faltan,
      delim: delim,
      diag: filas.length + ' filas, ' + filas[0].length + ' columnas, separador ' + (delim === '\t' ? 'TAB' : '"' + delim + '"') +
        ', cabecera: ' + JSON.stringify(cab) + (filas[0].length > 8 ? '…' : '') + ' (1ª celda en hex: ' + cod + ')'
    };
  }
  if (mejor.k > 0) filas = filas.slice(mejor.k);
  return { filas: filas, iTOM: mejor.iTOM, delim: delim, filaCabecera: mejor.k };
}

/**
 * Archivos de TOM en la carpeta: el nombre se busca con y sin mayúsculas (el robot lo sube en minúsculas),
 * el más reciente primero.
 */
function _archivosTOMDrive_(carpeta) {
  const vistos = {}, lista = [];
  [TOM_DRIVE_ARCHIVO, TOM_DRIVE_ARCHIVO.toLowerCase()].forEach(nombre => {
    const it = carpeta.getFilesByName(nombre);
    while (it.hasNext()) {
      const f = it.next();
      if (!vistos[f.getId()]) { vistos[f.getId()] = true; lista.push(f); }
    }
  });
  lista.sort((a, b) => b.getLastUpdated().getTime() - a.getLastUpdated().getTime());
  return lista;
}

/**
 * Lee y parsea el CSV de TOM desde Drive.
 * Devuelve { filas, iTOM } si todo va bien (filas[0] = cabecera, incluida);
 * o { error } con un mensaje ya listo para toast si algo falla (carpeta o
 * archivo no encontrado, o faltan columnas esperadas en la cabecera).
 */
function _leerTOMDesdeDrive_() {
  let archivos;
  try {
    archivos = _archivosTOMDrive_(DriveApp.getFolderById(TOM_DRIVE_CARPETA_ID));
  } catch (e) {
    return { error: 'TOM (Drive): no puedo acceder a la carpeta (' + e.message + ').' };
  }
  if (!archivos.length) {
    return { error: 'TOM (Drive): no encuentro "' + TOM_DRIVE_ARCHIVO + '" en la carpeta.' };
  }

  const problemas = [];
  for (let n = 0; n < archivos.length; n++) {
    const archivo = archivos[n];
    const nombre = archivo.getName() + ' (' + archivo.getSize() + ' bytes, ' +
      Utilities.formatDate(archivo.getLastUpdated(), 'Europe/Madrid', 'dd/MM HH:mm') + ')';
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
      if (r.filas) return { filas: r.filas, iTOM: r.iTOM };
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
