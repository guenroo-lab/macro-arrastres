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
 */

const TOM_DRIVE_CARPETA_ID = '1_1muNRzTzLrgSLyZdWtpf7GJeRqbplIG';
const TOM_DRIVE_ARCHIVO = 'Pedidos_Totales.csv';

/** Columnas que TODOS los procesos necesitan como mínimo para funcionar. */
const TOM_DRIVE_COLUMNAS_MINIMAS = ['pyxis', 'transporte', 'referencia', 'descReferencia', 'tipoLinea', 'cantidad', 'pegase'];

/**
 * Lee y parsea el CSV de TOM desde Drive.
 * Devuelve { filas, iTOM } si todo va bien (filas[0] = cabecera, incluida);
 * o { error } con un mensaje ya listo para toast si algo falla (carpeta o
 * archivo no encontrado, o faltan columnas esperadas en la cabecera).
 */
function _leerTOMDesdeDrive_() {
  let carpeta, archivos;
  try {
    carpeta = DriveApp.getFolderById(TOM_DRIVE_CARPETA_ID);
    archivos = carpeta.getFilesByName(TOM_DRIVE_ARCHIVO);
  } catch (e) {
    return { error: 'TOM (Drive): no puedo acceder a la carpeta (' + e.message + ').' };
  }
  if (!archivos.hasNext()) {
    return { error: 'TOM (Drive): no encuentro "' + TOM_DRIVE_ARCHIVO + '" en la carpeta.' };
  }
  const archivo = archivos.next();

  let texto;
  try {
    texto = archivo.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    return { error: 'TOM (Drive): no puedo leer el archivo (' + e.message + ').' };
  }

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
  texto = texto.split(BOM).join('\n');

  let filas;
  try {
    filas = Utilities.parseCsv(texto, ';');
  } catch (e) {
    return { error: 'TOM (Drive): el archivo no se puede leer como CSV (' + e.message + ').' };
  }
  // Las BOM seguidas al principio dejan "filas" en blanco antes de la
  // cabecera real (una línea vacía entre cada costura consecutiva) -> se saltan.
  while (filas.length && filas[0].every(c => t_(c) === '')) filas.shift();
  if (!filas.length) return { error: 'TOM (Drive): el archivo está vacío.' };

  const iTOM = _indicesTOM_(filas[0]);
  const faltan = TOM_DRIVE_COLUMNAS_MINIMAS.filter(k => iTOM[k] === undefined);
  if (faltan.length) {
    return { error: 'TOM (Drive): no encuentro en la cabecera estas columnas: ' + faltan.join(', ') + '.' };
  }

  return { filas: filas, iTOM: iTOM };
}
