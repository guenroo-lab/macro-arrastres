# Meco: ZIP automático → impresión CCM + etiquetas HODOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soltar un ZIP de Meco en un botón nuevo del panel de MacroArrastres, y que automáticamente (a) genere la vista de impresión de CCM (una página por tienda: E014/E036/E043/E279) y (b) dé de alta en la app HODOS (proyecto aparte, Supabase) las etiquetas de PLAT MALAGA (origen MECO, un lote por tienda).

**Architecture:** Todo ocurre en memoria dentro de una única llamada de servidor (`procesarZipMeco`) en MacroArrastres: `Utilities.unzip()` descomprime, se localizan los 5 archivos que importan (4 Albaran de CCM + 1 xlsx de PLAT MALAGA), se mapean/agrupan, se genera el HTML de impresión, y se llama por HTTP al webhook `doPost` del proyecto `hodos` (que gana una rama nueva `accion:'registrarLoteMeco'` sin tocar su comportamiento actual para INCPC/Preparación).

**Tech Stack:** Google Apps Script (V8), HtmlService, `Utilities.unzip`/`parseCsv`, Drive API avanzada (v2, solo para leer el `.xlsx`), `UrlFetchApp` para el webhook cruzado entre proyectos, Node.js (`vm.runInContext`) para las pruebas antes de cada `clasp push`.

---

## Mapa de archivos

**MacroArrastres** (`C:\Users\30081048\Desktop\Proyectos\MacroArrastes`):
- `MecoZip.gs` — **nuevo**. Entrada `procesarZipMeco(base64, nombreArchivo)`: descomprime, localiza los archivos, orquesta CCM (Task 3) y PLAT MALAGA→HODOS (Task 5), junta el resultado.
- `MecoAlbaran.gs` — **nuevo**. Parseo del Albaran CSV → filas TOP-Meco + HTML de impresión con salto de página por tienda.
- `MecoHodos.gs` — **nuevo**. Lectura del `.xlsx` de PLAT MALAGA (vía Drive temporal) + agrupación por tienda + llamada al webhook de `hodos`.
- `MecoZipForm.html` — **nuevo**. Diálogo con `<input type="file">`, lee el ZIP como base64, llama a `procesarZipMeco`.
- `Retenidos.gs` — **modificado**. `_fechaEnvioPorOrigen_` gana un segundo parámetro opcional `fechaBase`.
- `Menu.gs` — **modificado**. Entrada de menú + función `abrirMecoZip()` que abre el diálogo.
- `Panel.html` — **modificado**. Botón nuevo en una sección "Meco (ZIP)".
- `appsscript.json` — **modificado**. Añade el servicio avanzado Drive v2 (necesario solo para leer el `.xlsx`).

**hodos** (`C:\Users\30081048\Desktop\Proyectos\hodos`):
- `IntegracionIncpc.gs` — **modificado**. `doPost` distingue por `datos.accion`; nuevas `crearLoteMecoDesdeMacroArrastres_` y `_loteMecoReciente_`.
- `test/integracionMeco.test.js` — **nuevo**. Sigue el patrón de test existente del proyecto (`node --test`).

No se toca ninguna hoja de cálculo real durante las pruebas — todo se prueba con datos simulados en Node antes de cualquier `clasp push`.

---

### Task 1: Generalizar `_fechaEnvioPorOrigen_` para aceptar una fecha base

**Files:**
- Modify: `Retenidos.gs:167-176`
- Test: (script Node ad-hoc, no hay carpeta `test/` en este proyecto — se prueba con `node -e` inline, mismo estilo que el resto de la sesión)

- [ ] **Step 1: Escribir el archivo de prueba**

Crear `C:\Users\30081048\Desktop\skills\test_fechaenvio_base.js`:

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';
global.SpreadsheetApp = { getActive: () => ({ getSpreadsheetTimeZone: () => 'Europe/Madrid' }) };
global.Utilities = { formatDate: (d) => { const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); } };
['Config.gs', 'Menu.gs', 'Retenidos.gs'].forEach(f => require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

// Jueves 03/09/2026 (real, del Albaran) -> +1 día = viernes 04/09/2026 (día laborable, sin salto)
check(_fechaEnvioPorOrigen_('Meco', new Date(2026, 8, 3)) === '04/09/2026', 'jueves 03/09 -> viernes 04/09 (sin salto)');

// Viernes 04/09/2026 -> +1 día = sábado -> salta a lunes 07/09/2026
check(_fechaEnvioPorOrigen_('Meco', new Date(2026, 8, 4)) === '07/09/2026', 'viernes 04/09 -> sábado salta a lunes 07/09');

// Sin segundo argumento: sigue funcionando como antes (usa "hoy", no lanza excepción)
let sinCrash = true;
try { _fechaEnvioPorOrigen_('Meco'); } catch (e) { sinCrash = false; }
check(sinCrash, 'llamada SIN fechaBase (retrocompatible) no lanza excepción');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `cd C:\Users\30081048\Desktop\skills && node test_fechaenvio_base.js`
Expected: los dos primeros `check` dan `FALLO` (la función todavía no acepta `fechaBase`, siempre usa "hoy" y el resultado no coincidirá con las fechas del test salvo casualidad).

- [ ] **Step 3: Generalizar la función**

En `Retenidos.gs`, reemplazar (líneas 167-176):

```javascript
function _fechaEnvioPorOrigen_(tipo) {
  const t = t_(tipo);
  const off = CFG.DIA_POR_ORIGEN.hasOwnProperty(t) ? CFG.DIA_POR_ORIGEN[t] : 0;
  const d = new Date();
  d.setDate(d.getDate() + off);
  const dow = d.getDay();                 // 0 = domingo, 6 = sábado
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
}
```

por:

```javascript
/**
 * Día de envío por origen: +N días (CFG.DIA_POR_ORIGEN) desde una fecha base,
 * saltando fin de semana al lunes. Por defecto la base es "hoy" (uso normal:
 * retenidos, carátula). `fechaBase` (Date) permite calcularlo desde OTRA
 * fecha — p. ej. la FECHA del Albaran de Meco en vez de "hoy" (ver MecoAlbaran.gs).
 */
function _fechaEnvioPorOrigen_(tipo, fechaBase) {
  const t = t_(tipo);
  const off = CFG.DIA_POR_ORIGEN.hasOwnProperty(t) ? CFG.DIA_POR_ORIGEN[t] : 0;
  const d = fechaBase ? new Date(fechaBase.getTime()) : new Date();
  d.setDate(d.getDate() + off);
  const dow = d.getDay();                 // 0 = domingo, 6 = sábado
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'dd/MM/yyyy');
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_fechaenvio_base.js`
Expected: `TODO OK`

- [ ] **Step 5: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/Retenidos.gs','utf8')); console.log('OK')"`
Expected: `OK`

No hay commit (el proyecto no tiene repo git) — se deja el archivo modificado, listo para el `clasp push` final (Task 8).

---

### Task 2: `MecoZip.gs` — descomprimir y localizar los archivos que importan

**Files:**
- Create: `MecoZip.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_zip_localizar.js`

- [ ] **Step 1: Escribir el test (con nombres de ruta sintéticos, sin depender del ZIP real)**

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

// Blobs falsos: solo necesitamos getName() para esta parte.
function blobFalso(nombre) { return { getName: () => nombre, getDataAsString: () => 'contenido de ' + nombre }; }

const nombres = [
  'R-4416-BCW/CCM/03-09-2026 05246897 E014          -x/Albaran-448-05246897.csv',
  'R-4416-BCW/CCM/03-09-2026 05246897 E014          -x/Bultos1Rec-448-05246897.csv',
  'R-4416-BCW/CCM/03-09-2026 05246897 E014          -x/ContenidosEntregados-448-05246897.csv',
  'R-4416-BCW/CCM/03-09-2026 05246897 E014          -x/flag.txt',
  'R-4416-BCW/CCM/03-09-2026 05246897 E036          -x/Albaran-448-05246897.csv',
  'R-4416-BCW/CCM/03-09-2026 05246897 E043          -x/Albaran-448-05246897.csv',
  'R-4416-BCW/CCM/03-09-2026 05246897 E279          -x/Albaran-448-05246897.csv',
  'R-4416-BCW/CCM/R-4416-BCW.xlsx',
  'R-4416-BCW/PLAT MALAGA/03-09-2026 05247340 E014          -x/Albaran-448-05247340.csv',
  'R-4416-BCW/PLAT MALAGA/03-09-2026 05247340 E036          -x/Albaran-448-05247340.csv',
  'R-4416-BCW/PLAT MALAGA/03-09-2026 05247340 E279          -x/Albaran-448-05247340.csv',
  'R-4416-BCW/PLAT MALAGA/R-4416-BCW.xlsx'
];
const blobs = nombres.map(blobFalso);

global.Utilities = {};
['Config.gs', 'Menu.gs', 'MecoZip.gs'].forEach(f => require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const r = _localizarArchivosMeco_(blobs);
console.log(JSON.stringify({
  ccm: Object.keys(r.ccm),
  platMalagaXlsx: r.platMalagaXlsx ? r.platMalagaXlsx.getName() : null,
  faltan: r.faltan
}, null, 2));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(Object.keys(r.ccm).sort().join(',') === 'E014,E036,E043,E279', 'las 4 tiendas de CCM localizadas');
check(r.ccm['E036'].getName().indexOf('E036') !== -1, 'Albaran de E036 es el correcto');
check(r.platMalagaXlsx && r.platMalagaXlsx.getName() === 'R-4416-BCW/PLAT MALAGA/R-4416-BCW.xlsx', 'xlsx de PLAT MALAGA localizado (y no el de dentro de CCM)');
check(r.faltan.length === 0, 'nada declarado como faltante cuando todo está presente');

// Caso con un Albaran de CCM faltante
const sinE043 = blobs.filter(b => b.getName().indexOf('E043') === -1);
const r2 = _localizarArchivosMeco_(sinE043);
check(r2.faltan.indexOf('CCM/E043') !== -1, 'detecta que falta el Albaran de E043');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_zip_localizar.js`
Expected: `ReferenceError: _localizarArchivosMeco_ is not defined` (el archivo `MecoZip.gs` aún no existe).

- [ ] **Step 3: Crear `MecoZip.gs`**

```javascript
/**
 * MECO — ZIP AUTOMÁTICO
 * Sustituye el pegado manual: un ZIP trae CCM/ (4 tiendas, se quedan en
 * plataforma) y PLAT MALAGA/ (van a tienda, se dan de alta en HODOS).
 * Ver docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
 */

const MECO_TIENDAS_CODIGO = ['E014', 'E036', 'E043', 'E279']; // CCM: las 4. PLAT MALAGA solo trae E014/E036/E279.

/**
 * De todos los blobs de un ZIP descomprimido, localiza:
 * - ccm: { 'E014': blobAlbaran, 'E036': ..., ... } — el Albaran-*.csv de cada
 *   subcarpeta de tienda dentro de CCM/.
 * - platMalagaXlsx: el único .xlsx que cuelga directo de "PLAT MALAGA/" (no
 *   el de dentro de CCM/, ni ninguno en una subcarpeta de tienda).
 * - faltan: lista de qué se esperaba y no apareció (ej. 'CCM/E043').
 */
function _localizarArchivosMeco_(blobs) {
  const ccm = {};
  let platMalagaXlsx = null;

  blobs.forEach(b => {
    const nombre = b.getName();

    if (nombre.indexOf('/CCM/') !== -1 && /\/Albaran-/.test(nombre)) {
      const carpeta = nombre.split('/CCM/')[1] || '';
      const m = carpeta.match(/E(014|036|043|279)/);
      if (m && !ccm['E' + m[1]]) ccm['E' + m[1]] = b;
      return;
    }

    if (nombre.indexOf('/PLAT MALAGA/') !== -1 && /\.xlsx$/i.test(nombre)) {
      // Directo bajo "PLAT MALAGA/": sin más "/" después de esa carpeta.
      const resto = nombre.split('/PLAT MALAGA/')[1] || '';
      if (resto.indexOf('/') === -1) platMalagaXlsx = b;
    }
  });

  const faltan = [];
  MECO_TIENDAS_CODIGO.forEach(cod => { if (!ccm[cod]) faltan.push('CCM/' + cod); });
  if (!platMalagaXlsx) faltan.push('PLAT MALAGA/xlsx');

  return { ccm: ccm, platMalagaXlsx: platMalagaXlsx, faltan: faltan };
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_zip_localizar.js`
Expected: `TODO OK`

- [ ] **Step 5: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/MecoZip.gs','utf8')); console.log('OK')"`
Expected: `OK`

---

### Task 3: `MecoAlbaran.gs` — Albaran → filas TOP-Meco + impresión por tienda

**Files:**
- Create: `MecoAlbaran.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_albaran.js`

- [ ] **Step 1: Escribir el test con datos reales del Albaran**

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

// 3 líneas reales de CCM/E036 (mismas columnas que trae el CSV real).
const csvE036 = `ALMACEN;ID_OPTIMUS;FLETE;FECHA;COD_TIENDA;TIENDA;CIRCUITO;PEDIDO;FLUJO;SECCION;REF_LM;DESIG;EAN;CANTIDAD;DOM;PYXIS;CONTENIDO;CONTE_AGRUP;SOP_ALM1;AGRUP_ALM1;SOP_ALM2;TRANSPORTE
448;4146285;5246897;03/09/2026;E036;MALAGA;STOCK;99609298;CCM;7;82162169;LAVABO MIA PORCELANA 101 CM;'8435410538157;1;34364947;285229;'1480904;'1480976;53354000;53354100;0;SI
448;4146285;5246897;03/09/2026;E036;MALAGA;STOCK;99609298;CCM;7;90099986;GRIFO BIDET SWIFT 2024 CR;'4005176743108;1;34364947;285229;'1479464;'1480985;53351644;53354111;0;SI`;

global.Utilities = {
  parseCsv: (texto, delim) => texto.split(/\r?\n/).filter(l => l.length).map(l => l.split(delim)),
  formatDate: (d) => { const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }
};
global.SpreadsheetApp = { getActive: () => ({ getSpreadsheetTimeZone: () => 'Europe/Madrid' }) };
['Config.gs', 'Menu.gs', 'Retenidos.gs', 'MecoAlbaran.gs'].forEach(f => require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const blobFalso = { getDataAsString: () => csvE036 };
const filas = _albaranAFilasTOP_(blobFalso);
console.log(JSON.stringify(filas, null, 2));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(filas.length === 2, '2 filas de datos (cabecera del Albaran no cuenta)');
check(filas[0][0] === '4146285', 'col A (Optimus) = ID_OPTIMUS');
check(filas[0][2] === '5246897', 'col C (Flete) = FLETE');
check(filas[0][5] === 'MALAGA', 'col F (Tienda) = TIENDA');
check(filas[0][7] === '99609298', 'col H (Pedido) = PEDIDO');
check(filas[0][10] === '82162169', 'col K (LM) = REF_LM');
check(filas[0][11] === 'LAVABO MIA PORCELANA 101 CM', 'col L (Artículo) = DESIG');
check(filas[0][12] === "'8435410538157", 'col M (EAN) = EAN (tal cual, con el apóstrofo delante)');
check(filas[0][13] === '1', 'col N (Cantidad) = CANTIDAD');
check(filas[0][15] === '285229', 'col P (Pyxis) = PYXIS');
check(filas[0].length === 21, 'fila con el mismo ancho (21 col) que usa procesarMeco');

const html = _htmlImpresionCCM_({ 'E036': blobFalso }, new Date(2026, 8, 3));
check(html.indexOf('page-break-before') !== -1, 'el HTML lleva salto de página');
check(html.indexOf('04/09/2026') !== -1, 'la fecha calculada (jueves 03/09 + 1 = viernes 04/09) aparece en el HTML');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_albaran.js`
Expected: `ReferenceError: _albaranAFilasTOP_ is not defined`

- [ ] **Step 3: Crear `MecoAlbaran.gs`**

```javascript
/**
 * MECO — CCM: Albaran (CSV) -> filas en el mismo layout que usa procesarMeco()
 * (Proceso_Meco.gs), e impresión con salto de página por tienda. No toca la
 * hoja TOP real: todo en memoria, para la vista de impresión.
 */

// Cabecera real del Albaran (';' como separador):
// ALMACEN;ID_OPTIMUS;FLETE;FECHA;COD_TIENDA;TIENDA;CIRCUITO;PEDIDO;FLUJO;SECCION;
// REF_LM;DESIG;EAN;CANTIDAD;DOM;PYXIS;CONTENIDO;CONTE_AGRUP;SOP_ALM1;AGRUP_ALM1;SOP_ALM2;TRANSPORTE
const MECO_ALBARAN_COL = {
  ID_OPTIMUS: 1, FLETE: 2, FECHA: 3, TIENDA: 5, PEDIDO: 7,
  REF_LM: 10, DESIG: 11, EAN: 12, CANTIDAD: 13, PYXIS: 15
};

/**
 * Convierte el Albaran de una tienda en filas con el mismo ancho/índices que
 * usa procesarMeco() (21 columnas, 0-based): A=Optimus, C=Flete, F=Tienda,
 * H=Pedido, K=LM, L=Artículo, M=EAN, N=Cantidad, P=Pyxis. El resto vacío.
 */
function _albaranAFilasTOP_(blobAlbaran) {
  const texto = blobAlbaran.getDataAsString();
  const filas = Utilities.parseCsv(texto, ';');
  const N = 21;
  const out = [];
  for (let i = 1; i < filas.length; i++) { // fila 0 = cabecera del Albaran
    const f = filas[i];
    const fila = new Array(N).fill('');
    fila[0] = f[MECO_ALBARAN_COL.ID_OPTIMUS];
    fila[2] = f[MECO_ALBARAN_COL.FLETE];
    fila[5] = f[MECO_ALBARAN_COL.TIENDA];
    fila[7] = f[MECO_ALBARAN_COL.PEDIDO];
    fila[10] = f[MECO_ALBARAN_COL.REF_LM];
    fila[11] = f[MECO_ALBARAN_COL.DESIG];
    fila[12] = f[MECO_ALBARAN_COL.EAN];
    fila[13] = f[MECO_ALBARAN_COL.CANTIDAD];
    fila[15] = f[MECO_ALBARAN_COL.PYXIS];
    out.push(fila);
  }
  return out;
}

/** Parsea "dd/mm/yyyy" (formato del campo FECHA del Albaran) a Date. */
function _fechaAlbaranADate_(texto) {
  const m = t_(texto).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/**
 * HTML de impresión de CCM: una tienda por página (salto de página antes de
 * cada una, salvo la primera). ccmPorTienda: { 'E014': blob, 'E036': blob, ... }.
 * fechaLlegada: Date ya calculada (día siguiente al Albaran, con el salto de
 * fin de semana de siempre) — se muestra igual en las 4 páginas.
 */
function _htmlImpresionCCM_(ccmPorTienda, fechaLlegada) {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const fechaTxt = Utilities.formatDate(fechaLlegada, tz, 'dd/MM/yyyy');
  const ORDEN = ['E014', 'E036', 'E043', 'E279'];

  const paginas = ORDEN
    .filter(cod => ccmPorTienda[cod])
    .map((cod, idx) => {
      const filas = _albaranAFilasTOP_(ccmPorTienda[cod]);
      const filasHtml = filas.map(f =>
        '<tr><td>' + esc_(f[0]) + '</td><td>' + esc_(f[2]) + '</td><td>' + esc_(f[5]) + '</td><td>' +
        esc_(f[7]) + '</td><td>' + esc_(f[10]) + '</td><td>' + esc_(f[11]) + '</td><td>' +
        esc_(f[12]) + '</td><td>' + esc_(f[13]) + '</td><td>' + esc_(f[15]) + '</td></tr>'
      ).join('\n');
      const salto = idx > 0 ? 'page-break-before: always;' : '';
      return '<div style="' + salto + '">' +
        '<h2>' + cod + ' — llegada ' + fechaTxt + '</h2>' +
        '<table border="1" cellspacing="0" cellpadding="4">' +
        '<tr><th>Optimus</th><th>Flete</th><th>Tienda</th><th>Pedido</th><th>LM</th><th>Artículo</th><th>EAN</th><th>Cantidad</th><th>Pyxis</th></tr>' +
        filasHtml + '</table></div>';
    }).join('\n');

  return '<html><body>' + paginas + '</body></html>';
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_albaran.js`
Expected: `TODO OK`

- [ ] **Step 5: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/MecoAlbaran.gs','utf8')); console.log('OK')"`
Expected: `OK`

**Nota para quien implemente:** `_htmlImpresionCCM_` de este task es deliberadamente simple (una tabla por página, sin el `transform:scale` que usa `Impresion.gs` para tablas anchas). Si al probarlo en real se ve mal a tamaño de impresión, reutilizar el mismo patrón `avail=1160` + `transform:scale` de `htmlImprimirTOP` (`Impresion.gs`) — no es parte de este plan porque no se puede validar visualmente sin abrir la Sheet real; queda para el checklist de verificación manual (Task 8).

---

### Task 4: `appsscript.json` + `MecoHodos.gs` (lectura del xlsx) — Parte 1

**Files:**
- Modify: `appsscript.json`
- Create: `MecoHodos.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_hodos_xlsx.js` (test de la parte de AGRUPACIÓN únicamente; la lectura real del `.xlsx` vía Drive **no se puede simular en Node** — se deja como paso de verificación manual en Task 8, igual que el resto de este proyecto no puede ejecutar Apps Script real desde local)

- [ ] **Step 1: Añadir el servicio avanzado Drive a `appsscript.json`**

Leer el archivo actual, y añadir la clave `dependencies.enabledAdvancedServices` (si `dependencies` ya existe vacío `{}`, sustituir por esto):

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Drive", "serviceId": "drive", "version": "v2" }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

- [ ] **Step 2: Validar que sigue siendo JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/appsscript.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 3: Escribir el test de agrupación por tienda (sin tocar Drive)**

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';
global.Utilities = {};
['Config.gs', 'Menu.gs', 'MecoHodos.gs'].forEach(f => require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

// Filas ya "leídas" del xlsx (como si vinieran de getDataRange().getValues()):
// Cod. Tienda | Nom.Tienda | Expedición | CMP | Peso
const filasXlsx = [
  ['Cod. Tienda', 'Nom.Tienda', 'Expedición', 'CMP', 'Peso'],
  ['E014          ', 'MARBELLA', 5247340, 53352497, 119.33],
  ['E014          ', 'MARBELLA', 5247340, 53354241, 45],
  ['E036          ', 'MALAGA', 5247340, 53352121, 46.5],
  ['E279          ', 'MIJAS', 5247340, 53354594, 306]
];

const r = _agruparPlatMalagaPorTienda_(filasXlsx);
console.log(JSON.stringify(r, null, 2));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(r.length === 3, '3 grupos (Marbella, Málaga, Mijas)');
const marbella = r.find(g => g.destino === 'Marbella');
check(!!marbella && marbella.pedidosTexto === '53352497\n53354241', 'Marbella: 2 CMP unidos con salto de línea, en orden');
check(r.find(g => g.destino === 'Málaga').pedidosTexto === '53352121', 'Málaga: 1 CMP');
check(r.find(g => g.destino === 'Mijas').pedidosTexto === '53354594', 'Mijas: 1 CMP');

// Código de tienda desconocido: se ignora la fila, no rompe nada.
const conCodigoRaro = filasXlsx.concat([['E999          ', 'X', 1, 999, 1]]);
const r2 = _agruparPlatMalagaPorTienda_(conCodigoRaro);
check(r2.length === 3, 'un código de tienda no reconocido se ignora sin romper el resto');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 4: Ejecutar y confirmar que falla**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_hodos_xlsx.js`
Expected: `ReferenceError: _agruparPlatMalagaPorTienda_ is not defined`

- [ ] **Step 5: Crear `MecoHodos.gs` (primera mitad: lectura xlsx + agrupación)**

```javascript
/**
 * MECO — PLAT MALAGA -> etiquetas HODOS (origen MECO).
 * HODOS es un proyecto/webapp aparte (C:\Users\30081048\Desktop\Proyectos\hodos,
 * Supabase). Aquí solo se agrupa por tienda y se llama a su webhook — ver
 * docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
 */

// E014/E036/E279 (E043 no aparece en PLAT MALAGA, no se opera en tienda).
const MECO_TIENDA_CANONICA = { 'E014': 'Marbella', 'E036': 'Málaga', 'E279': 'Mijas' };

/**
 * Sube temporalmente el blob .xlsx a Drive convertido a Google Sheets, lee su
 * primera hoja como valores, y BORRA el archivo temporal (éxito o error).
 * Requiere el servicio avanzado Drive v2 (ver appsscript.json).
 */
function _leerXlsxComoValores_(blob) {
  const recurso = { title: 'tmp-meco-' + Utilities.getUuid(), mimeType: MimeType.GOOGLE_SHEETS };
  const archivo = Drive.Files.insert(recurso, blob, { convert: true });
  try {
    const ss = SpreadsheetApp.openById(archivo.id);
    return ss.getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(archivo.id);
  }
}

/**
 * Agrupa las filas del xlsx de PLAT MALAGA (Cod.Tienda|Nom.Tienda|Expedición|
 * CMP|Peso) por tienda canónica. Devuelve un array de
 * { destino: 'Marbella', pedidosTexto: '53352497\n53354241' } — uno por
 * tienda con al menos una fila, en el mismo orden en que aparecen las filas.
 * Un código de tienda no reconocido se ignora (no rompe el resto).
 */
function _agruparPlatMalagaPorTienda_(filasXlsx) {
  const porTienda = {}; // destino -> [] de CMP, en orden
  const orden = [];
  for (let i = 1; i < filasXlsx.length; i++) { // fila 0 = cabecera
    const codigo = t_(filasXlsx[i][0]);
    const destino = MECO_TIENDA_CANONICA[codigo];
    if (!destino) continue;
    const cmp = t_(filasXlsx[i][3]);
    if (cmp === '') continue;
    if (!porTienda[destino]) { porTienda[destino] = []; orden.push(destino); }
    porTienda[destino].push(cmp);
  }
  return orden.map(destino => ({ destino: destino, pedidosTexto: porTienda[destino].join('\n') }));
}
```

- [ ] **Step 6: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_hodos_xlsx.js`
Expected: `TODO OK`

- [ ] **Step 7: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/MecoHodos.gs','utf8')); console.log('OK')"`
Expected: `OK`

**Nota:** `_leerXlsxComoValores_` no se puede probar en Node (depende de `Drive`/`SpreadsheetApp` reales de Apps Script). Se verifica en Task 8 con el ZIP real.

---

### Task 5: `MecoHodos.gs` — llamada al webhook de HODOS

**Files:**
- Modify: `MecoHodos.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_hodos_webhook.js`

- [ ] **Step 1: Escribir el test (con `UrlFetchApp` simulado)**

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

const llamadas = [];
global.UrlFetchApp = {
  fetch: (url, opciones) => {
    llamadas.push({ url, payload: JSON.parse(opciones.payload) });
    const payload = JSON.parse(opciones.payload);
    // Simula: Marbella OK, Málaga falla (token inválido, por ejemplo).
    const cuerpo = payload.destino === 'Málaga'
      ? { ok: false, error: 'Token inválido' }
      : { ok: true, idsCreados: ['HODOS-000123'] };
    return { getContentText: () => JSON.stringify(cuerpo) };
  }
};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => ({ INCPC_SHARED_TOKEN: 'token-secreto', HODOS_WEBAPP_URL: 'https://script.google.com/macros/s/FAKE/exec' }[k])
})};
global.Session = { getActiveUser: () => ({ getEmail: () => 'pedro.gil@ext.leroymerlin.es' }) };
['Config.gs', 'Menu.gs', 'MecoHodos.gs'].forEach(f => require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const grupos = [
  { destino: 'Marbella', pedidosTexto: '53352497\n53354241' },
  { destino: 'Málaga', pedidosTexto: '53352121' }
];
const resultado = _enviarLotesMecoAHodos_(grupos);
console.log(JSON.stringify(resultado, null, 2));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(llamadas.length === 2, 'una llamada HTTP por tienda (2 grupos -> 2 llamadas)');
check(llamadas[0].payload.accion === 'registrarLoteMeco', 'la llamada lleva accion=registrarLoteMeco');
check(llamadas[0].payload.token === 'token-secreto', 'lleva el token de Propiedades del script');
check(llamadas[0].payload.operario === 'pedro.gil@ext.leroymerlin.es', 'lleva el email del usuario activo como operario');
check(resultado.ok.length === 1 && resultado.ok[0].destino === 'Marbella', 'Marbella queda como OK');
check(resultado.fallidos.length === 1 && resultado.fallidos[0].destino === 'Málaga', 'Málaga queda como fallido');
check(resultado.fallidos[0].error === 'Token inválido', 'el motivo del fallo se conserva tal cual');

// Sin configurar las Propiedades del script: error claro, no excepción.
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
const sinConfig = _enviarLotesMecoAHodos_(grupos);
check(sinConfig.errorConfig && /HODOS_WEBAPP_URL|INCPC_SHARED_TOKEN/.test(sinConfig.errorConfig), 'sin propiedades configuradas, error claro sin intentar llamar');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_hodos_webhook.js`
Expected: `ReferenceError: _enviarLotesMecoAHodos_ is not defined`

- [ ] **Step 3: Añadir la función a `MecoHodos.gs`** (al final del archivo)

```javascript
/**
 * Manda un lote por tienda al webhook de HODOS (accion:'registrarLoteMeco',
 * ver hodos/IntegracionIncpc.gs). Sigue con las demás tiendas aunque una
 * falle — nunca aborta el resto por un fallo puntual. Devuelve
 * { ok: [{destino, idsCreados}], fallidos: [{destino, error}] } o, si faltan
 * las Propiedades del script, { errorConfig: '...' } sin llamar a nada.
 */
function _enviarLotesMecoAHodos_(grupos) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('INCPC_SHARED_TOKEN');
  const url = props.getProperty('HODOS_WEBAPP_URL');
  if (!token || !url) {
    return { errorConfig: 'Faltan INCPC_SHARED_TOKEN o HODOS_WEBAPP_URL en Propiedades del script.' };
  }
  const operario = Session.getActiveUser().getEmail() || 'desconocido';

  const ok = [], fallidos = [];
  grupos.forEach(g => {
    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          accion: 'registrarLoteMeco', token: token,
          destino: g.destino, pedidosTexto: g.pedidosTexto, operario: operario
        }),
        muteHttpExceptions: true
      });
      const json = JSON.parse(resp.getContentText());
      if (json.ok) ok.push({ destino: g.destino, idsCreados: json.idsCreados || [] });
      else fallidos.push({ destino: g.destino, error: json.error || 'HODOS devolvió un error sin detalle' });
    } catch (e) {
      fallidos.push({ destino: g.destino, error: e.message });
    }
  });
  return { ok: ok, fallidos: fallidos };
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_hodos_webhook.js`
Expected: `TODO OK`

- [ ] **Step 5: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/MecoHodos.gs','utf8')); console.log('OK')"`
Expected: `OK`

---

### Task 6: Orquestador `procesarZipMeco` + diálogo + menú/panel

**Files:**
- Create: `MecoZipForm.html`
- Modify: `MecoZip.gs` (añadir `procesarZipMeco` y `abrirMecoZip`)
- Modify: `Menu.gs`
- Modify: `Panel.html`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_zip_orquestador.js`

- [ ] **Step 1: Escribir el test del orquestador (con las piezas de Drive/HTTP simuladas)**

```javascript
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

const csvE036 = `ALMACEN;ID_OPTIMUS;FLETE;FECHA;COD_TIENDA;TIENDA;CIRCUITO;PEDIDO;FLUJO;SECCION;REF_LM;DESIG;EAN;CANTIDAD;DOM;PYXIS;CONTENIDO;CONTE_AGRUP;SOP_ALM1;AGRUP_ALM1;SOP_ALM2;TRANSPORTE
448;4146285;5246897;03/09/2026;E036;MALAGA;STOCK;99609298;CCM;7;82162169;LAVABO MIA;'8435410538157;1;34364947;285229;'1480904;'1480976;53354000;53354100;0;SI`;

function blobFalso(nombre, contenido) { return { getName: () => nombre, getDataAsString: () => contenido }; }
const blobsZip = [
  blobFalso('R/CCM/x E014 -x/Albaran-1.csv', csvE036.replace('E036', 'E014')),
  blobFalso('R/CCM/x E036 -x/Albaran-1.csv', csvE036),
  blobFalso('R/CCM/x E043 -x/Albaran-1.csv', csvE036.replace('E036', 'E043')),
  blobFalso('R/CCM/x E279 -x/Albaran-1.csv', csvE036.replace('E036', 'E279')),
  blobFalso('R/PLAT MALAGA/R.xlsx', 'xlsx-fake')
];

global.Utilities = {
  unzip: () => blobsZip,
  newBlob: (bytes, tipo, nombre) => ({ getName: () => nombre }),
  parseCsv: (texto, delim) => texto.split(/\r?\n/).filter(l => l.length).map(l => l.split(delim)),
  formatDate: (d) => { const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); },
  base64Decode: (b64) => Buffer.from(b64, 'base64'),
  getUuid: () => 'uuid-fake'
};
global.SpreadsheetApp = { getActive: () => ({ getSpreadsheetTimeZone: () => 'Europe/Madrid', toast: () => {} }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => ({ INCPC_SHARED_TOKEN: 't', HODOS_WEBAPP_URL: 'https://x/exec' }[k]) }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'pedro.gil@ext.leroymerlin.es' }) };
const llamadasHttp = [];
global.UrlFetchApp = { fetch: (url, o) => { llamadasHttp.push(JSON.parse(o.payload)); return { getContentText: () => JSON.stringify({ ok: true, idsCreados: ['HODOS-1'] }) }; } };

// _leerXlsxComoValores_ depende de Drive real: se sustituye por una versión de
// prueba ANTES de cargar MecoHodos.gs para no reescribir el archivo real.
['Config.gs', 'Menu.gs', 'Retenidos.gs', 'MecoAlbaran.gs', 'MecoZip.gs', 'MecoHodos.gs'].forEach(f =>
  require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));
_leerXlsxComoValores_ = () => [
  ['Cod. Tienda', 'Nom.Tienda', 'Expedición', 'CMP', 'Peso'],
  ['E036', 'MALAGA', 1, 53352121, 46.5]
];

const resultado = procesarZipMeco('QkFTRTY0', 'R-4416-BCW.zip');
console.log(JSON.stringify(resultado, null, 2));

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(resultado.faltan.length === 0, 'todos los archivos esperados localizados');
check(typeof resultado.htmlImpresion === 'string' && resultado.htmlImpresion.indexOf('E036') !== -1, 'HTML de impresión generado, incluye E036');
check(llamadasHttp.length === 1 && llamadasHttp[0].destino === 'Málaga', 'se llamó a HODOS una vez, para Málaga (única tienda con fila en el xlsx simulado)');
check(resultado.hodos.ok.length === 1, 'HODOS: 1 tienda OK');
check(resultado.hodos.fallidos.length === 0, 'HODOS: 0 fallidos');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_zip_orquestador.js`
Expected: `TypeError: procesarZipMeco is not a function`

- [ ] **Step 3: Añadir `procesarZipMeco` y `abrirMecoZip` a `MecoZip.gs`** (al final del archivo)

```javascript
/**
 * Punto de entrada desde el diálogo (MecoZipForm.html). base64: contenido del
 * .zip en base64 (FileReader del navegador). Descomprime, procesa CCM (Task 3)
 * y PLAT MALAGA->HODOS (Task 5), y devuelve todo junto para el diálogo.
 */
function procesarZipMeco(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blobZip = Utilities.newBlob(bytes, 'application/zip', nombreArchivo);
  const blobs = Utilities.unzip(blobZip);

  const loc = _localizarArchivosMeco_(blobs);
  if (loc.faltan.length) {
    return { faltan: loc.faltan, htmlImpresion: null, hodos: null };
  }

  // Fecha de llegada: FECHA del Albaran de cualquiera de las tiendas (todas
  // traen la misma) + 1 día, salto de fin de semana de siempre.
  const primeraFila = Utilities.parseCsv(loc.ccm['E036'].getDataAsString(), ';')[1];
  const fechaAlbaran = _fechaAlbaranADate_(primeraFila[MECO_ALBARAN_COL.FECHA]);
  const fechaLlegadaTxt = _fechaEnvioPorOrigen_('Meco', fechaAlbaran);
  const [dd, mm, yyyy] = fechaLlegadaTxt.split('/');
  const fechaLlegada = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

  const htmlImpresion = _htmlImpresionCCM_(loc.ccm, fechaLlegada);

  const filasXlsx = _leerXlsxComoValores_(loc.platMalagaXlsx);
  const grupos = _agruparPlatMalagaPorTienda_(filasXlsx);
  const hodos = _enviarLotesMecoAHodos_(grupos);

  return { faltan: [], htmlImpresion: htmlImpresion, hodos: hodos };
}

/** Abre el diálogo de subida del ZIP (menú y panel). */
function abrirMecoZip() {
  const html = HtmlService.createHtmlOutputFromFile('MecoZipForm').setWidth(480).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Procesar ZIP de Meco');
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `node C:\Users\30081048\Desktop\skills\test_meco_zip_orquestador.js`
Expected: `TODO OK`

- [ ] **Step 5: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/MecoZip.gs','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 6: Crear `MecoZipForm.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; padding: 16px; }
    #estado { margin-top: 12px; white-space: pre-wrap; }
    .error { color: #c00; }
    .ok { color: #2a7; }
    button { margin-top: 12px; }
  </style>
</head>
<body>
  <p>Selecciona el ZIP de Meco (ej. <code>R-4416-BCW.zip</code>):</p>
  <input type="file" id="archivo" accept=".zip">
  <br><button onclick="procesar()">Procesar</button>
  <div id="estado"></div>

  <script>
    function procesar() {
      const input = document.getElementById('archivo');
      const estado = document.getElementById('estado');
      if (!input.files.length) { estado.textContent = 'Elige un archivo primero.'; return; }
      const archivo = input.files[0];
      estado.textContent = 'Leyendo y procesando…';

      const lector = new FileReader();
      lector.onload = function () {
        const base64 = lector.result.split(',')[1]; // quita "data:application/zip;base64,"
        google.script.run
          .withSuccessHandler(mostrarResultado)
          .withFailureHandler(function (err) { estado.innerHTML = '<span class="error">' + err.message + '</span>'; })
          .procesarZipMeco(base64, archivo.name);
      };
      lector.readAsDataURL(archivo);
    }

    function mostrarResultado(r) {
      const estado = document.getElementById('estado');
      if (r.faltan.length) {
        estado.innerHTML = '<span class="error">Faltan archivos en el ZIP:<br>' + r.faltan.join('<br>') + '</span>';
        return;
      }
      let txt = '<span class="ok">CCM listo para imprimir.</span><br>';
      if (r.hodos.errorConfig) {
        txt += '<span class="error">HODOS: ' + r.hodos.errorConfig + '</span>';
      } else {
        txt += 'HODOS: ' + r.hodos.ok.length + ' tienda(s) OK';
        if (r.hodos.fallidos.length) {
          txt += '<br><span class="error">Fallaron: ' + r.hodos.fallidos.map(function (f) { return f.destino + ' (' + f.error + ')'; }).join(', ') + '</span>';
        }
      }
      estado.innerHTML = txt;
      const ventana = window.open('', '_blank');
      ventana.document.write(r.htmlImpresion);
    }
  </script>
</body>
</html>
```

- [ ] **Step 7: Añadir la entrada de menú en `Menu.gs`**

Localizar el bloque `.addSubMenu(ui.createMenu('① PROCESAR') ... )` (líneas 10-14 aprox.) y añadir una línea:

```javascript
    .addSubMenu(ui.createMenu('① PROCESAR')
      .addItem('📦  Antequera: PDF → TOP', 'abrirAntequera')
      .addItem('📦  Meco: ZIP → CCM + HODOS', 'abrirMecoZip')
      .addItem('🟢  Arrastres (Valencia · Torija · Antequera)', 'procesarArrastres')
      .addItem('📥  Marcar pedidos a retener (Recepción)', 'procesarRecepcion')
      .addItem('🚛  Meco — aplicar formato', 'procesarMecoMenu'))
```

- [ ] **Step 8: Añadir el botón en `Panel.html`**

En la sección "① PROCESAR" del panel (buscar el botón de Antequera como referencia de estilo), añadir justo después:

```html
    <button class="btn" onclick="run(this,'abrirMecoZip')">
      <i class="fa-solid fa-file-zipper"></i>
      <span>Meco: ZIP → CCM + HODOS<small>Sustituye el pegado manual del ZIP de Meco</small></span>
    </button>
```

- [ ] **Step 9: Validar balance de `<div>` de `Panel.html`**

Run:
```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/Panel.html','utf8'); const o=(html.match(/<div/g)||[]).length; const c=(html.match(/<\/div>/g)||[]).length; console.log('abiertos:',o,'cerrados:',c, o===c?'OK':'DESCUADRADO');"
```
Expected: `OK` (el botón nuevo no añade ningún `<div>`, así que el balance no debería cambiar respecto al que ya tenía el archivo).

- [ ] **Step 10: Validar sintaxis de `Menu.gs`**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/Menu.gs','utf8')); console.log('OK')"`
Expected: `OK`

---

### Task 7: `hodos` — nueva rama en `doPost` para lotes de Meco

**Files:**
- Modify: `C:\Users\30081048\Desktop\Proyectos\hodos\IntegracionIncpc.gs`
- Test: `C:\Users\30081048\Desktop\Proyectos\hodos\test\integracionMeco.test.js` (usa `node --test`, mismo runner que ya tiene el proyecto)

- [ ] **Step 1: Mirar cómo están estructurados los tests existentes del proyecto**

Run: `node --test C:\Users\30081048\Desktop\Proyectos\hodos\test\ --test-name-pattern nada 2>&1 | head -5`

(Solo para confirmar que `node --test` funciona en este proyecto y ver el estilo de mocks que ya usan — leer por ejemplo `test/backendAdmin.test.js` para copiar el patrón exacto de cómo mockean `registrarLote`/`leerEtiquetas_` antes de escribir el test nuevo.)

- [ ] **Step 2: Escribir el test que falla**

Crear `C:\Users\30081048\Desktop\Proyectos\hodos\test\integracionMeco.test.js`, siguiendo el MISMO patrón de mocks que ya usa el resto de `test/*.test.js` de este proyecto (cargar `IntegracionIncpc.gs` con `vm`, stubear `registrarLote`/`leerEtiquetas_`/`PropertiesService` como globals antes de cargarlo):

```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

function cargarConMocks(mocks) {
  const sandbox = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }), MimeType: { JSON: 'JSON' } }
  }, mocks);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/../IntegracionIncpc.gs', 'utf8'), sandbox);
  return sandbox;
}

test('registrarLoteMeco: llama a registrarLote con origen MECO y sin subtipo', () => {
  const llamadas = [];
  const sb = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1', 'HODOS-2'] }; },
    leerEtiquetas_: () => []
  });
  const resultado = sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111\n222', operario: 'pedro@x.com' });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].origen, 'MECO');
  assert.strictEqual(llamadas[0].subtipo, undefined);
  assert.strictEqual(llamadas[0].destino, 'Marbella');
  assert.strictEqual(llamadas[0].pedidosTexto, '111\n222');
  assert.match(llamadas[0].creadoPor, /^MacroArrastres \(Meco\) · pedro@x\.com$/);
  assert.deepStrictEqual(resultado, { ok: true, idsCreados: ['HODOS-1', 'HODOS-2'] });
});

test('registrarLoteMeco: tienda no reconocida da error sin llamar a registrarLote', () => {
  const llamadas = [];
  const sb = cargarConMocks({ registrarLote: (d) => { llamadas.push(d); }, leerEtiquetas_: () => [] });
  assert.throws(() => sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Sevilla', pedidosTexto: '111' }), /Tienda destino no reconocida/);
  assert.strictEqual(llamadas.length, 0);
});

test('registrarLoteMeco: pedidosTexto vacío da error sin llamar a registrarLote', () => {
  const llamadas = [];
  const sb = cargarConMocks({ registrarLote: (d) => { llamadas.push(d); }, leerEtiquetas_: () => [] });
  assert.throws(() => sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '   ' }), /Falta la lista de pedidos/);
  assert.strictEqual(llamadas.length, 0);
});

test('registrarLoteMeco: si ya hay un lote MECO reciente para esa tienda, no duplica', () => {
  const llamadas = [];
  const sb = cargarConMocks({
    registrarLote: (d) => { llamadas.push(d); return { ids: ['NUEVO'] }; },
    leerEtiquetas_: () => [{ idUnico: 'HODOS-VIEJO' }]
  });
  const resultado = sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111' });
  assert.strictEqual(llamadas.length, 0, 'no debe llamar a registrarLote si hay uno reciente');
  assert.strictEqual(resultado.duplicado, true);
});

test('doPost: accion registrarLoteMeco llama a crearLoteMecoDesdeMacroArrastres_, sin accion sigue el camino de siempre (INCPC)', () => {
  const llamadasIncpc = [];
  const llamadasMeco = [];
  const sb = cargarConMocks({
    crearEtiquetaDesdeIncpc_: (d) => { llamadasIncpc.push(d); return 'HODOS-INCPC'; },
    registrarLote: (d) => { llamadasMeco.push(d); return { ids: ['HODOS-MECO'] }; },
    leerEtiquetas_: () => []
  });

  const eMeco = { postData: { contents: JSON.stringify({ token: 'token-real', accion: 'registrarLoteMeco', destino: 'Mijas', pedidosTexto: '999' }) } };
  const rMeco = JSON.parse(sb.doPost(eMeco).getContent());
  assert.strictEqual(rMeco.ok, true);
  assert.strictEqual(llamadasMeco.length, 1);
  assert.strictEqual(llamadasIncpc.length, 0);

  const eIncpc = { postData: { contents: JSON.stringify({ token: 'token-real', destino: 'Mijas', pedido: '123', tipo: 'Devolución' }) } };
  const rIncpc = JSON.parse(sb.doPost(eIncpc).getContent());
  assert.strictEqual(rIncpc.ok, true);
  assert.strictEqual(llamadasIncpc.length, 1, 'sin accion, sigue llamando a crearEtiquetaDesdeIncpc_ como siempre');
  assert.strictEqual(llamadasMeco.length, 1, 'y NO llama a la rama de Meco');
});
```

- [ ] **Step 3: Ejecutar y confirmar que falla**

Run: `cd C:\Users\30081048\Desktop\Proyectos\hodos && node --test test/integracionMeco.test.js`
Expected: fallos por `TypeError: sb.crearLoteMecoDesdeMacroArrastres_ is not a function` (todavía no existe).

- [ ] **Step 4: Modificar `doPost` y añadir las funciones nuevas en `IntegracionIncpc.gs`**

Reemplazar el `doPost` actual (líneas 6-21):

```javascript
function doPost(e) {
  var respuesta;
  try {
    var datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
    if (!tokenEsperado || datos.token !== tokenEsperado) {
      respuesta = { ok: false, error: 'Token inválido' };
    } else if (datos.accion === 'registrarLoteMeco') {
      respuesta = crearLoteMecoDesdeMacroArrastres_(datos);
    } else {
      var idUnico = crearEtiquetaDesdeIncpc_(datos);
      respuesta = { ok: true, idUnico: idUnico };
    }
  } catch (err) {
    respuesta = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}
```

Añadir, después de `crearEtiquetaDesdeIncpc_` (tras la línea 91 del archivo original, antes de `notificarAgrupacionAIncpc_`):

```javascript
// Integración con MacroArrastres (Meco): un lote de CMP por tienda, origen
// MECO — sin subtipo (solo tiene sentido para origen Taisa, ver
// subtipoEfectivo en Utilidades.gs). Ver
// MacroArrastres/docs/superpowers/specs/2026-09-04-meco-zip-hodos-design.md.
function crearLoteMecoDesdeMacroArrastres_(datos) {
  var destino = validarTienda(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  if (!String(datos.pedidosTexto || '').trim()) throw new Error('Falta la lista de pedidos (CMP)');

  var creadoPor = 'MacroArrastres (Meco) · ' + (datos.operario || 'desconocido');

  if (_loteMecoReciente_(destino)) {
    return { ok: true, idsCreados: [], duplicado: true, motivo: 'Ya se procesó un ZIP de Meco para ' + destino + ' hace menos de 3 min.' };
  }

  var resultado = registrarLote({ origen: 'MECO', destino: destino, pedidosTexto: datos.pedidosTexto, creadoPor: creadoPor });
  return { ok: true, idsCreados: resultado.ids };
}

// Antiduplicado si el mismo ZIP se sube dos veces (doble clic, reintento de
// red) — mismo espíritu que _etiquetaIncpcReciente_, pero por destino
// (un lote entero, no una etiqueta individual).
function _loteMecoReciente_(destino) {
  var desdeIso = new Date(Date.now() - UMBRAL_DUPLICADO_INCPC_MS_).toISOString();
  var filtro = 'origen=eq.MECO&destino=eq.' + encodeURIComponent(destino)
    + '&creado_por=like.MacroArrastres*'
    + '&fecha_creacion=gte.' + encodeURIComponent(desdeIso) + '&limit=1';
  return leerEtiquetas_(filtro).length > 0;
}
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `cd C:\Users\30081048\Desktop\Proyectos\hodos && node --test test/integracionMeco.test.js`
Expected: 5 tests, todos en verde.

- [ ] **Step 6: Ejecutar TODA la suite del proyecto para descartar una regresión**

Run: `cd C:\Users\30081048\Desktop\Proyectos\hodos && node --test`
Expected: mismos tests que antes de este cambio, todos en verde, más los 5 nuevos.

- [ ] **Step 7: Validar sintaxis**

Run: `node -e "const fs=require('fs'); new Function(fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/hodos/IntegracionIncpc.gs','utf8')); console.log('OK')"`
Expected: `OK`

**Verificado (ejecución 2026-09-04):** el filtro de `_loteMecoReciente_` (`origen=eq.MECO&...&creado_por=like.MacroArrastres*&fecha_creacion=gte...`) se comparó contra `filaEtiquetaHaciaSupabase_`/`filaEtiquetaDesdeSupabase_` (`EstructuraSheets.gs`): `origen`, `destino`, `creado_por` y `fecha_creacion` son exactamente los nombres de columna reales. Sin cambios necesarios.

---

### Task 8: Configuración manual + verificación end-to-end con el ZIP real

**Files:** ninguno (solo pasos manuales + un test de humo final)

- [ ] **Step 1: Pedro configura las Propiedades del script de MacroArrastres**

En el editor de Apps Script de MacroArrastres → Configuración del proyecto (⚙️) → Propiedades del script → añadir:
- `INCPC_SHARED_TOKEN` = el mismo valor que ya tiene configurado en el proyecto `hodos`.
- `HODOS_WEBAPP_URL` = la URL `/exec` del despliegue actual de `hodos`.

- [ ] **Step 2: Pedro habilita el servicio avanzado Drive (si no se activa solo)**

En el editor de Apps Script de MacroArrastres → Servicios (icono +) → añadir "Drive API" (debería quedar ya declarado por el `appsscript.json` del Task 4; si al ejecutar sale un error de tipo "Drive is not defined" o "API no habilitada", añadirlo a mano aquí).

- [ ] **Step 3: `clasp push` de MacroArrastres**

Run: `cd C:\Users\30081048\Desktop\Proyectos\MacroArrastes && clasp push -f`
Expected: lista de archivos subida, incluyendo `MecoZip.gs`, `MecoAlbaran.gs`, `MecoHodos.gs`, `MecoZipForm.html`.

- [ ] **Step 4: `clasp push` de hodos**

Run: `cd C:\Users\30081048\Desktop\Proyectos\hodos && clasp push -f`
Expected: lista de archivos subida, incluyendo `IntegracionIncpc.gs` modificado. **Si `hodos` tiene un despliegue de webapp propio (no solo "head"), hay que crear una nueva versión desplegada** (`clasp deploy` o desde el editor) para que `doPost` recoja el cambio — el código del editor NO es lo mismo que sirve `/exec` hasta que se redespliega.

- [ ] **Step 5: Verificación manual con el ZIP real**

En la Sheet de MacroArrastres: abrir el panel → "📦 Meco: ZIP → CCM + HODOS" → seleccionar un ZIP real de Meco → Procesar. Comprobar:
1. Se abre una ventana de impresión con 4 páginas (una por tienda), cada una con sus pedidos del Albaran correspondiente.
2. El mensaje final dice cuántas tiendas de HODOS quedaron OK y cuáles fallaron (si alguna).
3. En la app `hodos` (Buscador Interno o pantalla de carga), buscar por origen `MECO` y confirmar que aparecen las etiquetas nuevas con el destino y los CMP correctos, y `creadoPor` empezando por "MacroArrastres (Meco) ·".

- [ ] **Step 6: Repetir el mismo ZIP una segunda vez (a propósito)**

Objetivo: confirmar que el antiduplicado de Task 7 funciona — la segunda vez, HODOS debe responder `duplicado: true` para cada tienda en vez de crear etiquetas repetidas.

---

## Cobertura del spec

- ZIP → localizar archivos (CCM ×4 + xlsx PLAT MALAGA), avisar de lo que falte: **Task 2**.
- Albaran → filas TOP-Meco, mismo mapeo de columnas que `procesarMeco()`: **Task 3**.
- Fecha automática desde el Albaran + salto de fin de semana: **Task 1 + Task 3**.
- Impresión con salto de página por tienda (E014/E036/E043/E279): **Task 3**.
- Lectura del `.xlsx` de PLAT MALAGA (vía Drive avanzada): **Task 4**.
- Agrupación por tienda + lote (no por fila): **Task 4**.
- Llamada al webhook de HODOS, errores parciales sin abortar: **Task 5**.
- Diálogo de subida + menú + panel: **Task 6**.
- `doPost` de HODOS con la rama nueva, sin tocar INCPC/Preparación: **Task 7**.
- Antiduplicado de lotes MECO: **Task 7**.
- Config manual (tokens, servicio Drive, despliegue) + verificación real: **Task 8**.
- El pegado manual de Meco en TOP (botón actual) no se toca en ningún task — sigue igual.
- Fase 2 (pestaña "Meco" dedicada en `hodos/Index.html`) queda **fuera de este plan**, tal como se acordó en el spec.
