# Plan 2 de 3 — MacroArrastres: automatización (núcleo/interfaz, HODOS, impresión, cajones)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `procesarArrastres()` mande solo las etiquetas automáticamente a HODOS y abra la impresión (carátula + TOP) al terminar, y que Valencia/Torija (CSV) y Recepción (XLSX) se puedan procesar soltando el archivo en vez de pegarlo en TOP — sin cambiar el comportamiento de lo que ya funciona hoy.

**Architecture:** Cada proceso (`procesarArrastres`, `procesarRecepcion`) se parte en un núcleo que calcula y devuelve un objeto (sin tocar la interfaz) y un envoltorio fino con el nombre de siempre que hace el `toast` y, en arrastres, abre el diálogo de impresión — así el menú y el panel siguen funcionando exactamente igual. El núcleo de arrastres, además, agrupa las líneas de HODOS por origen+tienda+**expedición** y las manda a la app HODOS con el webhook `registrarLoteArrastre` del Plan 1. Los cajones nuevos (CSV, XLSX) escriben TOP y llaman al mismo camino de siempre.

**Tech Stack:** Google Apps Script (V8, sintaxis ES5 en los archivos existentes; se puede usar `const`/`let`/arrow en archivos que ya los usan, como `Proceso_Arrastres.gs`), `node --test` con `global.X = ...` + `vm.runInThisContext` (mismo patrón que los tests de Meco — sin `vm.createContext`, así que no hay problema de "realms" distintos aquí), `clasp`.

**Spec:** `docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md`, secciones 4, 5.B, 5.C, 5.D.

**Alcance de este plan:** solo `MacroArrastres`. Depende de que el Plan 1 (HODOS) esté desplegado — usa `registrarLoteArrastre`. No incluye la interfaz web nueva (Plan 3): los cajones de este plan son diálogos modales, como el de Meco.

---

## Contexto que el implementador necesita

**MacroArrastres no es un repositorio git.** Sin pasos de commit. El punto de control de cada tarea es "las pruebas pasan". El despliegue es la última tarea.

**Cómo se lanzan las pruebas.** No hay `package.json`, ni carpeta `test/` dentro del proyecto: los tests viven en `C:\Users\30081048\Desktop\skills\`, con el prefijo `test_`, y cargan los `.gs` reales con `require('vm').runInThisContext(...)` sobre el **contexto global de Node** (no `vm.createContext`) tras rellenar `global.Utilities`, `global.SpreadsheetApp`, etc. — mismo patrón que `test_meco_zip_orquestador.js`. Como todo comparte el realm de Node, **no hace falta** el truco de `JSON.parse(JSON.stringify(...))` que sí hace falta en los tests de `hodos` (ahí sí se usa `vm.createContext`, un realm aislado).

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_hodos_agrupacion.js"
```

(cada test es un script independiente que se lanza con `node <archivo>` — no hay un runner común).

**`_generarHodos_` no tiene test hoy.** Es una función central sin cobertura; esta tarea le añade su primera prueba automatizada justo donde se toca (origen/expedición), no se pretende cubrir toda la lógica de cerámica/CC2/LS ya existente.

**Un fallo latente que ya se debe conocer** (del Plan 1): si algún día se reactiva el flujo legado "Meco — aplicar formato" (que sí pasa por TOP), su columna A llega como `'Meco'` (vía `CFG.ORIGENES['E448']`), no `'MECO'`. No hace falta arreglar nada aquí: `_validarOrigenArrastre_` en HODOS ya compara sin distinguir mayúsculas y siempre devuelve la grafía canónica.

**Decisión de diseño — impresión automática vía `showModalDialog`, no `window.open`.** Meco abre una pestaña nueva (`window.open`) porque su formulario (`MecoZipForm.html`) tiene JavaScript de cliente que puede hacerlo. `procesarArrastres()` lo llaman tanto el **menú** (sin ningún JavaScript de cliente disponible: un clic de menú solo puede invocar `SpreadsheetApp.getUi().showModalDialog(...)`) como el **panel** (`Panel.html`, que si tuviera que abrir una ventana necesitaría cambios en ese archivo). Para no tocar `Panel.html` y que el menú funcione igual, `procesarArrastres()` abre la impresión con `SpreadsheetApp.getUi().showModalDialog(...)` — funciona igual la llames desde el menú o desde `google.script.run`. Los cajones nuevos de este plan (Task 7 y Task 9) llaman a `procesarArrastres()`/`procesarRecepcion()` por dentro, así que heredan este mismo mecanismo sin código de cliente adicional.

**Por qué no se reutiliza `htmlImprimirTOP()` para la impresión automática.** `htmlImprimirTOP()` ya está en producción y lleva un script de autoajuste de ancho bastante delicado. En vez de extraerlo y arriesgar una regresión ahí, la impresión automática de arrastres usa su propia función nueva y sencilla (`_htmlImpresionArrastres_`, Task 4), con el mismo estilo simple de tabla que ya usa Meco (`_htmlImpresionCCM_` en `MecoAlbaran.gs`) — sin tocar `htmlImprimirTOP()`.

**Windows-1252 en Apps Script.** `Blob.getDataAsString(charset)` acepta cualquier charset reconocido por Java, incluido `'Windows-1252'`. No hace falta ninguna librería.

---

## Estructura de archivos

| Archivo | Responsabilidad | Qué se hace |
|---|---|---|
| `Hodos.gs` | Genera la hoja HODOS | `_generarHodos_` añade origen+expedición por línea a lo que devuelve |
| `ArrastresHodos.gs` (nuevo) | Envío genérico a HODOS | Agrupación por origen+tienda+expedición y llamada al webhook `registrarLoteArrastre` |
| `MecoHodos.gs` | Envío de Meco a HODOS | `_enviarLotesMecoAHodos_` pasa a ser un envoltorio de una línea sobre `ArrastresHodos.gs`; `_agruparPlatMalagaPorTienda_` agrupa también por expedición (arregla un bug real: hoy junta expediciones distintas en un mismo lote) |
| `Impresion.gs` | Impresión directa | `_htmlImpresionArrastres_` nueva (carátula + TOP en un documento) |
| `Proceso_Arrastres.gs` | Proceso de arrastres | Se parte en `_procesarArrastresNucleo_` (calcula, sin UI) y `procesarArrastres` (toast + diálogo de impresión) |
| `Proceso_Recepcion.gs` | Proceso de recepción | Se parte en `_procesarRecepcionNucleo_` y `procesarRecepcion` (toast, sin impresión ni HODOS) |
| `ArrastreCsv.gs` (nuevo) | Cajón CSV Valencia/Torija | Decodifica Windows-1252, vuelca a TOP, llama a `procesarArrastres()` |
| `ArrastreCsvForm.html` (nuevo) | Diálogo del cajón CSV | Selector de archivo, igual que `MecoZipForm.html` |
| `RecepcionXlsx.gs` (nuevo) | Cajón XLSX Recepción | Normaliza números/tienda, vuelca a TOP, llama a `procesarRecepcion()` |
| `RecepcionXlsxForm.html` (nuevo) | Diálogo del cajón XLSX | Igual patrón |
| `Menu.gs` | Menú y panel | Dos entradas de menú nuevas |

---

## Tarea 1: `_generarHodos_` — origen y expedición por línea

**Files:**
- Modificar: `Hodos.gs:184-351` (`_generarHodos_`)
- Modificar: `Proceso_Arrastres.gs:300` (la llamada)
- Test: `C:\Users\30081048\Desktop\skills\test_arrastres_hodos_agrupacion.js` (nuevo)

**Diseño.** Cada grupo de salida (soporte, "suelto" de Málaga, o grupo LS) ya se identifica por tienda+algo; se le añade el origen y la expedición de la PRIMERA fila que entra en ese grupo (todas las filas de un mismo soporte físico comparten origen y expedición, porque vienen del mismo envío). Las líneas de TRAMECO no tienen origen (siguen sin mandarse a HODOS): se marcan con `origen: null`.

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastres_hodos_agrupacion.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = {
  HOJAS: { HODOS: 'HODOS', TRAMECO: 'TRAMECO', CERAMICA: 'CERAMICA' },
  COLORES: {}
};
global.CacheService = { getDocumentCache: () => null }; // sin caché -> siempre lee "la hoja"
global.t_ = v => String(v == null ? '' : v).trim();
global.SpreadsheetApp = {
  getActive: () => ({
    getSheetByName: (nombre) => {
      if (nombre === 'CERAMICA') {
        return { getLastRow: () => 3, getRange: () => ({ getValues: () => [['82162169'], ['90099986']] }) };
      }
      if (nombre === 'TRAMECO') return null; // sin TRAMECO en este test
      if (nombre === 'HODOS') return hojaHodosFalsa;
      return null;
    },
    insertSheet: () => hojaHodosFalsa
  })
};
global._lmNum_ = v => { const n = Number(v); return isNaN(n) ? v : n; };

const celdas = [];
const hojaHodosFalsa = {
  clear: () => {},
  getRange: (r, c, nf, nc) => ({
    setValues: (vals) => { vals.forEach((f, i) => celdas.push(f)); return { setBorder: () => {} }; },
    setNumberFormat: () => ({ setValues: (vals) => { vals.forEach(f => celdas.push(f)); } }),
    setFontWeight: () => ({ setBackground: () => ({ setHorizontalAlignment: () => {} }) }),
    setBorder: () => {}
  }),
  setColumnWidth: () => {}
};

require('vm').runInThisContext(fs.readFileSync(path + 'Hodos.gs', 'utf8'), { filename: 'Hodos.gs' });

// TOP (filasFinal): cabecera + 2 filas del mismo soporte Marbella (99, cerámica,
// sin transporte) con Origen=Valencia/Expedición=EXP-1, y 1 fila CC2 de Torija
// con Origen=Torija/Expedición=EXP-2 (CC2 no pasa por cerámica, entra siempre).
const filasFinal = [
  new Array(23).fill(''),
  // A=Origen  B=Exp    G=Tienda   J=Pegase   K=Pyxis  L=Flujo M=Agr P=Soporte S=LM   T=EAN
  ['Valencia','EXP-1','Marbella','99000111','555111','', '',  'SOP-1','82162169','', , , , , , , , , , , , ,],
  ['Valencia','EXP-1','Marbella','99000222','555222','', '',  'SOP-1','90099986','', , , , , , , , , , , , ,],
  ['Torija',  'EXP-2','Marbella','88000333','555333','CC2','','SOP-9','',        '', , , , , , , , , , , , ,]
];
const tom = [
  ['Nº Pedido cliente','Tiene transporte'],
  ['555111','NO'], ['555222','NO']
];
const iTOM = { pyxis: 0, transporte: 1, pegase: 0 };
const cA=0,cB=1,cG=6,cJ=9,cK=10,cL=11,cP=15,cS=18,cT=19;

const r = _generarHodos_(filasFinal, tom, tom.length, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT);

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(Array.isArray(r.lineas), 'devuelve r.lineas (array)');
const marbella = r.lineas.filter(l => l.tienda === 'Marbella')[0];
check(!!marbella, 'hay una línea de Marbella');
check(marbella && marbella.origen === 'Valencia', 'línea de Marbella lleva origen Valencia');
check(marbella && marbella.expedicion === 'EXP-1', 'línea de Marbella lleva expedición EXP-1');
check(marbella && marbella.texto === '555111+555222', 'agrupa los dos pedidos del mismo soporte con "+"');

const cc2 = r.lineas.filter(l => l.origen === 'Torija')[0];
check(!!cc2, 'hay una línea CC2 de Torija');
check(cc2 && cc2.expedicion === 'EXP-2', 'la línea CC2 lleva su propia expedición (EXP-2, distinta de la de Marbella)');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_hodos_agrupacion.js"
```

Esperado: FALLO — `r.lineas` es `undefined` (`_generarHodos_` todavía no lo devuelve).

- [ ] **Paso 3: Cambiar la firma y el rastreo de origen/expedición**

En `Hodos.gs`, cambia la firma de `_generarHodos_` (línea 184):

```javascript
function _generarHodos_(filasFinal, tom, uTOM, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT) {
```

Dentro de `_grupo_` (línea 204), guarda origen/expedición la primera vez que se crea el soporte:

```javascript
  const _grupo_ = (tienda, soporte, modo, origen, expedicion) => {
    if (!porTienda[tienda]) porTienda[tienda] = { soportes: {}, orden: [], sueltos: {}, ordenSueltos: [], origenSueltos: {}, expSueltos: {} };
    const T = porTienda[tienda];
    if (!(soporte in T.soportes)) {
      T.soportes[soporte] = { pedidos: {}, orden: [], modo: modo, origen: origen, expedicion: expedicion };
      T.orden.push(soporte);
    } else if (modo === 'junto') T.soportes[soporte].modo = 'junto';   // 'junto' manda
    return T;
  };
```

Localiza el bucle principal (línea 212) y añade la lectura de origen/expedición justo después de calcular `tienda`:

```javascript
  for (let f = 1; f < filasFinal.length; f++) {
    const fila = filasFinal[f];
    const gNorm = t_(fila[cG]).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tienda = TIENDAS[gNorm];
    if (!tienda) continue;                                    // solo Málaga/Marbella/Mijas

    const origenFila = t_(fila[cA]);
    const expedicionFila = t_(fila[cB]);
```

Y pasa `origenFila, expedicionFila` en cada llamada a `_grupo_` — hay tres en el archivo. La de CC2 (línea ~234):

```javascript
    if (t_(fila[cL]).toUpperCase() === 'CC2') {
      nCC2++;
      const T = _grupo_(tienda, soporte, 'junto', origenFila, expedicionFila);
```

La de Málaga-99 "sueltos" (línea ~275) — además de `_grupo_`, guarda origen/expedición del suelto:

```javascript
    if (tienda === 'Málaga' && es99) {
      const T = _grupo_(tienda, soporte, 'malaga_no99', origenFila, expedicionFila);
      if (!(pyxis in T.sueltos)) {
        T.sueltos[pyxis] = true; T.ordenSueltos.push(pyxis);
        T.origenSueltos[pyxis] = origenFila; T.expSueltos[pyxis] = expedicionFila;
      }
      continue;
    }
```

La del resto (Marbella/Mijas-99 y Málaga-no99, línea ~283):

```javascript
    const modo = (tienda === 'Málaga') ? 'malaga_no99' : 'junto';
    const T = _grupo_(tienda, soporte, modo, origenFila, expedicionFila);
```

Para LS (Torija, línea ~244), guarda origen/expedición por soporte igual que en `_grupo_`:

```javascript
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
```

- [ ] **Paso 4: Construir `r.lineas` en el paso 2 (línea ~288)**

Sustituye el bloque "--- 2. Construir las filas de salida ---" completo por esta versión, que sigue rellenando `salida` (para la hoja, sin cambios visibles) y ADEMÁS construye `lineas` (para el envío a HODOS):

```javascript
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
          if (S.orden.length < 2) return;
          S.orden.forEach(p => {
            salida.push([tienda, p]);
            lineas.push({ tienda: tienda, texto: p, origen: S.origen, expedicion: S.expedicion });
          });
        } else {
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
  });

  // --- 3. Añadir los pedidos de TRAMECO (lo que antes iba a FLUJOSTRA) ---
  // Sin origen: no se mandan a HODOS (decisión del usuario).
  const tra = _pedidosTrameco_();
  tra.forEach(r => { salida.push(r); lineas.push({ tienda: r[0], texto: r[1], origen: null, expedicion: null }); });
```

- [ ] **Paso 5: Añadir `lineas` al objeto que se devuelve (línea ~341)**

```javascript
  return {
    filas: salida.length,
    lineas: lineas,
    ceramica: nCeramica,
    sinTransporte: nSinTransporte,
    cc2: nCC2,
    ls: nLS,
    trameco: tra.length,
    sinCatalogo: sinCatalogo,
    catalogoDeCache: !!_catalogoCeramica_.deCache
  };
```

- [ ] **Paso 6: Actualizar la llamada en `Proceso_Arrastres.gs`**

Línea 300, añade `cA, cB` a la llamada:

```javascript
  const hodos = _generarHodos_(filasFinal, tom, uTOM, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT);
```

- [ ] **Paso 7: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_hodos_agrupacion.js"
```

Esperado: `TODO OK`.

---

## Tarea 2: `ArrastresHodos.gs` — envío genérico agrupado

**Files:**
- Crear: `ArrastresHodos.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_arrastres_hodos_envio.js` (nuevo)

**Diseño.** Agrupa `lineas` (las que trae `_generarHodos_`, con `origen` no nulo) por `origen|tienda|expedicion` — **no** solo por origen+tienda, porque dos soportes de la misma plataforma y tienda pueden venir en expediciones distintas (dos entregas el mismo día), y cada expedición necesita su propio lote para que el antiduplicado de HODOS (Plan 1, clave `origen+destino+expedicion`) compare cada una contra lo que le corresponde.

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastres_hodos_envio.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'pedro.gil@ext.leroymerlin.es' }) };
global.ScriptApp = { getOAuthToken: () => 'oauth-token-de-prueba' };
global.MECO_HODOS_WEBAPP_URL = 'https://script.google.com/macros/s/FAKE/exec';
global.MECO_INCPC_SHARED_TOKEN = 'token-de-prueba';

const llamadas = [];
global.UrlFetchApp = {
  fetch: (url, opciones) => {
    const payload = JSON.parse(opciones.payload);
    llamadas.push({ url: url, payload: payload, headers: opciones.headers });
    const cuerpo = payload.destino === 'Málaga' && payload.expedicion === 'EXP-FALLA'
      ? { ok: false, error: 'Token inválido' }
      : { ok: true, idsCreados: ['HODOS-1'], omitidos: [] };
    return { getContentText: () => JSON.stringify(cuerpo) };
  }
};

require('vm').runInThisContext(fs.readFileSync(path + 'ArrastresHodos.gs', 'utf8'), { filename: 'ArrastresHodos.gs' });

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

// Dos soportes de Valencia+Marbella con expediciones DISTINTAS -> dos lotes.
const lineas = [
  { tienda: 'Marbella', texto: '111', origen: 'Valencia', expedicion: 'EXP-1' },
  { tienda: 'Marbella', texto: '222', origen: 'Valencia', expedicion: 'EXP-2' },
  { tienda: 'Mijas', texto: '333+444', origen: 'Torija', expedicion: 'EXP-3' },
  { tienda: 'Málaga', texto: '555', origen: null, expedicion: null } // TRAMECO: sin origen, no se manda
];

const resultado = _enviarLineasHodos_(lineas);

check(llamadas.length === 3, 'una llamada por combinación origen+tienda+expedición (3, no 4: TRAMECO no se manda)');
check(llamadas.filter(l => l.payload.destino === 'Marbella' && l.payload.expedicion === 'EXP-1').length === 1, 'lote Marbella/EXP-1');
check(llamadas.filter(l => l.payload.destino === 'Marbella' && l.payload.expedicion === 'EXP-2').length === 1, 'lote Marbella/EXP-2 SEPARADO del de EXP-1');
check(llamadas[0].payload.accion === 'registrarLoteArrastre', 'accion=registrarLoteArrastre');
check(llamadas[0].headers.Authorization === 'Bearer oauth-token-de-prueba', 'lleva Bearer del propio OAuth');
check(resultado.ok.length === 3, '3 lotes OK');
check(resultado.fallidos.length === 0, '0 fallidos (ninguno con EXP-FALLA en este test)');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_hodos_envio.js"
```

Esperado: FALLO — `_enviarLineasHodos_ is not defined`.

- [ ] **Paso 3: Escribir `ArrastresHodos.gs`**

```javascript
/**
 * ARRASTRES -> HODOS
 * Envío genérico de las líneas que devuelve _generarHodos_ (Hodos.gs) al
 * webhook de la app HODOS (registrarLoteArrastre, ver Plan 1). Reutilizado
 * también por Meco (MecoHodos.gs), que antes tenía su propio envío duplicado.
 *
 * Agrupa por origen+tienda+EXPEDICIÓN, no solo origen+tienda: dos entregas de
 * la misma plataforma a la misma tienda el mismo día son dos expediciones
 * distintas y necesitan lotes separados para que el antiduplicado de HODOS
 * (clave origen+destino+expedicion) compare cada una contra lo que le toca.
 */

/**
 * Agrupa líneas { tienda, texto, origen, expedicion } por origen|tienda|expedicion.
 * Las líneas sin origen (TRAMECO) se excluyen. Devuelve un array de
 * { origen, destino, pedidosTexto, expedicion }, uno por combinación, en el
 * orden en que aparece cada combinación por primera vez.
 */
function _agruparLineasHodosPorLote_(lineas) {
  const porClave = {};
  const orden = [];
  (lineas || []).forEach(l => {
    if (!l.origen) return; // TRAMECO: sin origen, no se manda
    const clave = l.origen + '|' + l.tienda + '|' + (l.expedicion || '');
    if (!porClave[clave]) {
      porClave[clave] = { origen: l.origen, destino: l.tienda, expedicion: l.expedicion || '', textos: [] };
      orden.push(clave);
    }
    porClave[clave].textos.push(l.texto);
  });
  return orden.map(clave => {
    const g = porClave[clave];
    return { origen: g.origen, destino: g.destino, pedidosTexto: g.textos.join('\n'), expedicion: g.expedicion };
  });
}

/**
 * Manda un lote por combinación origen+tienda+expedición al webhook de HODOS.
 * Sigue con los demás lotes aunque uno falle. Devuelve
 * { ok: [{origen, destino, idsCreados, omitidos}], fallidos: [{origen, destino, error}] }.
 * Config leída de MecoConfig.gs (con fallback a Propiedades del script) — mismo
 * mecanismo ya en uso por Meco, ver MecoHodos.gs.
 */
function _enviarLineasHodos_(lineas) {
  const grupos = _agruparLineasHodosPorLote_(lineas);
  if (!grupos.length) return { ok: [], fallidos: [] };

  const token = (typeof MECO_INCPC_SHARED_TOKEN !== 'undefined' && MECO_INCPC_SHARED_TOKEN !== 'PEGA_AQUI_EL_TOKEN')
    ? MECO_INCPC_SHARED_TOKEN : PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
  const url = (typeof MECO_HODOS_WEBAPP_URL !== 'undefined' && MECO_HODOS_WEBAPP_URL)
    ? MECO_HODOS_WEBAPP_URL : PropertiesService.getScriptProperties().getProperty('HODOS_WEBAPP_URL');
  if (!token || !url) {
    return { ok: [], fallidos: grupos.map(g => ({ origen: g.origen, destino: g.destino, error: 'Faltan INCPC_SHARED_TOKEN o HODOS_WEBAPP_URL (revisa MecoConfig.gs).' })) };
  }
  const operario = Session.getActiveUser().getEmail() || 'desconocido';

  const ok = [], fallidos = [];
  grupos.forEach(g => {
    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({
          accion: 'registrarLoteArrastre', token: token, origen: g.origen,
          destino: g.destino, pedidosTexto: g.pedidosTexto, expedicion: g.expedicion, operario: operario
        }),
        muteHttpExceptions: true
      });
      const json = JSON.parse(resp.getContentText());
      if (json.ok) ok.push({ origen: g.origen, destino: g.destino, idsCreados: json.idsCreados || [], omitidos: json.omitidos || [] });
      else fallidos.push({ origen: g.origen, destino: g.destino, error: json.error || 'HODOS devolvió un error sin detalle' });
    } catch (e) {
      fallidos.push({ origen: g.origen, destino: g.destino, error: e.message });
    }
  });
  return { ok: ok, fallidos: fallidos };
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_hodos_envio.js"
```

Esperado: `TODO OK`.

---

## Tarea 3: Meco reutiliza el envío genérico (y se arregla el bug de expedición mezclada)

**Files:**
- Modificar: `MecoHodos.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_meco_hodos_webhook.js` (existente — revisar tras el cambio)
- Test: `C:\Users\30081048\Desktop\skills\test_arrastres_meco_agrupacion_expedicion.js` (nuevo)

**El bug real que arregla esta tarea.** `_agruparPlatMalagaPorTienda_` hoy agrupa SOLO por tienda: si el xlsx de PLAT MALAGA trae dos filas de Málaga con `Expedición` distinta (dos entregas el mismo día), las junta en un único lote con un solo `pedidosTexto`, y ese lote solo puede llevar UNA expedición al webhook — la comparación de antiduplicado del Plan 1 quedaría mal para una de las dos. Se agrupa también por expedición.

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastres_meco_agrupacion_expedicion.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';
require('vm').runInThisContext(fs.readFileSync(path + 'MecoHodos.gs', 'utf8'), { filename: 'MecoHodos.gs' });

// Cod.Tienda | Nom.Tienda | Expedición | CMP | Peso
const filas = [
  ['Cod. Tienda', 'Nom.Tienda', 'Expedición', 'CMP', 'Peso'],
  ['E036', 'MALAGA', 'EXP-A', '111', 10],
  ['E036', 'MALAGA', 'EXP-A', '222', 12],
  ['E036', 'MALAGA', 'EXP-B', '333', 8]   // misma tienda, OTRA expedición
];

const grupos = _agruparPlatMalagaPorTienda_(filas);

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(grupos.length === 2, 'dos grupos: Málaga/EXP-A y Málaga/EXP-B, NO uno solo (bug real de expedición mezclada)');
const expA = grupos.filter(g => g.expedicion === 'EXP-A')[0];
const expB = grupos.filter(g => g.expedicion === 'EXP-B')[0];
check(!!expA && expA.pedidosTexto === '111\n222', 'EXP-A junta 111 y 222');
check(!!expB && expB.pedidosTexto === '333', 'EXP-B trae solo 333, separado de EXP-A');
check(grupos.every(g => g.destino === 'Málaga'), 'las dos siguen siendo destino Málaga');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_meco_agrupacion_expedicion.js"
```

Esperado: FALLO — 1 grupo en vez de 2.

- [ ] **Paso 3: Arreglar `_agruparPlatMalagaPorTienda_`**

Sustituye la función completa en `MecoHodos.gs`:

```javascript
/**
 * Agrupa las filas del xlsx de PLAT MALAGA (Cod.Tienda|Nom.Tienda|Expedición|
 * CMP|Peso) por tienda canónica Y EXPEDICIÓN — dos entregas a la misma tienda
 * el mismo día llevan expediciones distintas y deben salir como lotes
 * separados (si no, el antiduplicado por expedición de HODOS compararía mal
 * una de las dos). Devuelve un array de
 * { destino: 'Marbella', expedicion: '...', pedidosTexto: '53352497\n53354241' }.
 * Un código de tienda no reconocido se ignora (no rompe el resto).
 */
function _agruparPlatMalagaPorTienda_(filasXlsx) {
  const porClave = {}; // "destino|expedicion" -> { destino, expedicion, cmps: [] }
  const orden = [];
  for (let i = 1; i < filasXlsx.length; i++) { // fila 0 = cabecera
    const codigo = t_(filasXlsx[i][0]);
    const destino = MECO_TIENDA_CANONICA[codigo];
    if (!destino) continue;
    const expedicion = t_(filasXlsx[i][2]);
    const cmp = t_(filasXlsx[i][3]);
    if (cmp === '') continue;
    const clave = destino + '|' + expedicion;
    if (!porClave[clave]) { porClave[clave] = { destino: destino, expedicion: expedicion, cmps: [] }; orden.push(clave); }
    porClave[clave].cmps.push(cmp);
  }
  return orden.map(clave => {
    const g = porClave[clave];
    return { destino: g.destino, expedicion: g.expedicion, pedidosTexto: g.cmps.join('\n') };
  });
}
```

- [ ] **Paso 4: Sustituir `_enviarLotesMecoAHodos_` por un envoltorio del envío genérico**

Sustituye la función completa (la que hace `UrlFetchApp.fetch` a mano) por:

```javascript
/**
 * Manda un lote por tienda al webhook de HODOS, origen MECO. Desde el Plan 2
 * reutiliza el envío genérico (ArrastresHodos.gs) — antes tenía su propia
 * llamada a UrlFetchApp duplicada. `grupos` ya trae `expedicion` por grupo
 * (ver _agruparPlatMalagaPorTienda_), así que el antiduplicado del lado HODOS
 * compara cada entrega contra la que le corresponde de verdad.
 * Devuelve { ok: [{destino, idsCreados}], fallidos: [{destino, error}] } o,
 * si faltan las Propiedades/MecoConfig.gs, { ok: [], fallidos: [...] }.
 */
function _enviarLotesMecoAHodos_(grupos) {
  const lineas = grupos.map(g => ({ tienda: g.destino, texto: g.pedidosTexto, origen: 'MECO', expedicion: g.expedicion }));
  // _enviarLineasHodos_ junta por texto con '\n' si dos grupos comparten
  // origen+tienda+expedición; aquí cada grupo YA es único por esa clave, así
  // que el resultado es uno a uno con `grupos`.
  const r = _enviarLineasHodos_(lineas);
  if (r.ok.length === 0 && r.fallidos.length && r.fallidos[0].error && r.fallidos[0].error.indexOf('Faltan') === 0) {
    return { errorConfig: r.fallidos[0].error };
  }
  return {
    ok: r.ok.map(o => ({ destino: o.destino, idsCreados: o.idsCreados })),
    fallidos: r.fallidos.map(f => ({ destino: f.destino, error: f.error }))
  };
}
```

- [ ] **Paso 5: Lanzar el test nuevo**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_meco_agrupacion_expedicion.js"
```

Esperado: `TODO OK`.

- [ ] **Paso 6: Revisar el test existente de Meco**

`test_meco_hodos_webhook.js` llama a `_enviarLotesMecoAHodos_` con grupos SIN `expedicion` y comprueba la forma de la respuesta (`resultado.ok[0].destino === 'Marbella'`, etc.) y que la cabecera `Authorization` lleva el Bearer. Como `_enviarLotesMecoAHodos_` sigue aceptando `{destino, pedidosTexto}` (expedición `undefined` → `''` dentro de `_agruparLineasHodosPorLote_`) y sigue devolviendo la misma forma `{ok, fallidos}`, no debería hacer falta tocarlo. Lánzalo para confirmarlo:

```bash
node "C:/Users/30081048/Desktop/skills/test_meco_hodos_webhook.js"
```

Esperado: `TODO OK`. Si falla, es porque ese test carga solo `['Config.gs', 'Menu.gs', 'MecoHodos.gs']` (ver su cabecera) y ahora `MecoHodos.gs` necesita `_enviarLineasHodos_`, que vive en `ArrastresHodos.gs`. Añade `'ArrastresHodos.gs'` a esa lista de archivos cargados (la línea con `['Config.gs', 'Menu.gs', 'MecoHodos.gs'].forEach(...)`), y vuelve a lanzarlo.

- [ ] **Paso 7: Lanzar también el otro test que toca Meco**

```bash
node "C:/Users/30081048/Desktop/skills/test_meco_zip_orquestador.js"
```

Ese test carga `['Config.gs', 'Menu.gs', 'Retenidos.gs', 'Envio.gs', 'Impresion.gs', 'MecoAlbaran.gs', 'MecoZip.gs', 'MecoHodos.gs']` — añade también `'ArrastresHodos.gs'` a esa lista por el mismo motivo, y confirma `TODO OK`.

---

## Tarea 4: `_htmlImpresionArrastres_` — carátula + TOP en un documento

**Files:**
- Modificar: `Impresion.gs` (añadir función nueva; no se toca `htmlImprimirTOP` ni `_caratulaFragmento_`)
- Test: `C:\Users\30081048\Desktop\skills\test_arrastres_impresion.js` (nuevo)

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastres_impresion.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = { HOJAS: { TOP: 'TOP' }, COLORES: { LOGO_TAISA_B64: '' }, ORIGENES: {}, DIA_POR_ORIGEN: {} };
global.t_ = v => String(v == null ? '' : v).trim();
global.Utilities = { formatDate: () => '08/09/2026' };

const valoresTOP = [
  ['Valencia', 'EXP-1', '', '', '', '', 'Marbella'],
  ['', '', '', '', '', '', '']
];
const fondosTOP = [ new Array(7).fill('#ffffff'), new Array(7).fill('#d9ead3') ];

global.SpreadsheetApp = {
  getActive: () => ({
    getSpreadsheetTimeZone: () => 'Europe/Madrid',
    getSheetByName: (nombre) => (nombre === 'TOP' ? hojaTOPFalsa : null)
  })
};
const hojaTOPFalsa = {
  getLastRow: () => 2,
  getLastColumn: () => 7,
  isColumnHiddenByUser: () => false,
  getRange: () => ({
    getDisplayValues: () => valoresTOP,
    getDisplayValue: () => 'Marbella',
    getBackgrounds: () => fondosTOP
  })
};

['Retenidos.gs', 'Envio.gs', 'Impresion.gs'].forEach(f =>
  require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const r = _htmlImpresionArrastres_();

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(!r.error, 'sin error: ' + (r.error || ''));
check(r.html.indexOf('Plantilla de descarga') !== -1, 'lleva la carátula');
check(r.html.indexOf('>Valencia<') !== -1, 'la carátula pone el origen (Valencia)');
check(r.html.indexOf('<table>') !== -1, 'lleva la tabla de TOP');
check(r.html.indexOf('class="salto"') !== -1, 'salto de página entre carátula y TOP');
check(r.html.indexOf('window.print()') !== -1, 'se imprime sola al abrir (onload)');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_impresion.js"
```

Esperado: FALLO — `_htmlImpresionArrastres_ is not defined`.

- [ ] **Paso 3: Añadir la función a `Impresion.gs`**

Añade al final del archivo:

```javascript
/**
 * HTML de impresión automática de arrastres: carátula + hoja TOP en un solo
 * documento (salto de página entre ambas). Se abre sola al terminar
 * procesarArrastres() — mismo comportamiento que ya tiene Meco.
 *
 * Construye la tabla de TOP con su propio código simple (mismo estilo que
 * _htmlImpresionCCM_ de Meco, ver MecoAlbaran.gs), en vez de reutilizar
 * htmlImprimirTOP(): esa función ya está en producción con un script de
 * autoajuste de ancho delicado, y no merece la pena arriesgarla por esto.
 */
function _htmlImpresionArrastres_() {
  const car = _caratulaFragmento_();
  if (car.error) return { error: car.error };

  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(CFG.HOJAS.TOP);
  const u = ws ? ws.getLastRow() : 0;
  if (u < 1) return { error: 'La hoja TOP no tiene datos.' };

  const LIMITE = 22; // igual que htmlImprimirTOP: hasta la columna V
  const lastCol = Math.min(ws.getLastColumn(), LIMITE);
  const rng = ws.getRange(1, 1, u, lastCol);
  const vals = rng.getDisplayValues();
  const bgs = rng.getBackgrounds();
  const ocultas = [];
  for (let c = 1; c <= lastCol; c++) ocultas[c] = ws.isColumnHiddenByUser(c);

  let head = '', body = '';
  for (let r = 0; r < vals.length; r++) {
    let celdas = '';
    for (let c = 0; c < lastCol; c++) {
      if (ocultas[c + 1]) continue;
      if (r === 0) {
        celdas += '<th>' + esc_(vals[r][c]) + '</th>';
      } else {
        const bg = bgs[r][c];
        const st = (bg && bg.toLowerCase() !== '#ffffff') ? ' style="background:' + bg + '"' : '';
        celdas += '<td' + st + '>' + esc_(vals[r][c]) + '</td>';
      }
    }
    if (r === 0) head = '<tr>' + celdas + '</tr>'; else body += '<tr>' + celdas + '</tr>';
  }

  const cssTop =
    '.pagina{padding:10mm;}' +
    'table{border-collapse:collapse;width:100%;}' +
    'th,td{border:1px solid #555;padding:3px 5px;font-size:9px;text-align:left;white-space:nowrap;}' +
    'thead th{background:#333;color:#fff;}' +
    '@media print{@page{size:landscape;}.salto{page-break-before:always;}}';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Impresión de arrastres</title>' +
    '<style>' + car.css + cssTop + '</style></head><body onload="window.focus();window.print();">' +
    '<div class="pagina">' + car.cuerpo + '</div>' +
    '<div class="pagina salto"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
    '</body></html>';
  return { html: html };
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_impresion.js"
```

Esperado: `TODO OK`.

---

## Tarea 5: `procesarArrastres` — núcleo + envoltorio

**Files:**
- Modificar: `Proceso_Arrastres.gs:31-316` (`procesarArrastres`)
- Test: `C:\Users\30081048\Desktop\skills\test_arrastres_nucleo.js` (nuevo)

**Diseño.** `_procesarArrastresNucleo_()` es TODO lo que hace hoy `procesarArrastres()` **excepto** el `ss.toast(...)` final. Devuelve `{ error }` o `{ mensaje, resumen, hodos }` (`resumen` con los contadores que hoy solo viven dentro del mensaje de texto, por si Plan 3 los necesita sueltos). Al final del núcleo, si `hodos.lineas` tiene algo que mandar, se llama a `_enviarLineasHodos_` y su resultado se añade al mensaje. `procesarArrastres()` pasa a ser un envoltorio de 10 líneas.

- [ ] **Paso 1: Escribir el test del núcleo (sin UI, con envío a HODOS mockeado)**

Este test NO reprueba toda la lógica de cerámica/CC2/LS-SIE (ya la cubre el uso diario sin tests automatizados desde antes de este plan) — comprueba específicamente que el núcleo (a) no llama a `ss.toast` ni a `SpreadsheetApp.getUi()`, (b) manda a HODOS, y (c) devuelve un mensaje utilizable.

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastres_nucleo.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = {
  HOJAS: { TOP: 'TOP', EAN: 'EAN', FAMILIAS: 'FAMILIAS TIENDA', HODOS: 'HODOS', TRAMECO: 'TRAMECO', CERAMICA: 'CERAMICA' },
  COLORES: { MORADO: '#b4a7d6', VERDE_CLARO: '#d9ead3', VERDE_OSCURO: '#6aa84f', BLANCO: '#ffffff', GRIS_CABECERA: '#dcdcdc' },
  ORIGENES: { 'E439': 'Valencia' },
  TIENDA_ARRASTRE: { 'MALAGA': 'Málaga', 'MARBELLA': 'Marbella', 'MIJAS': 'Mijas' },
  AUTOAJUSTAR_COLUMNAS: false
};
global.t_ = v => String(v == null ? '' : v).trim();
global._lmNum_ = v => v;
global.ultimaFilaCol_ = (ws) => ws.filas.length;
global.autoajustar_ = () => {};
global.CacheService = { getDocumentCache: () => null };
global._leerTOMDesdeDrive_ = () => ({
  filas: [ ['Nº Pedido cliente', 'Tiene transporte', 'Referencia', 'Desc. Referencia', 'Tipo línea', 'Cantidad', 'Nº pedido proveedor'] ],
  iTOM: { pyxis: 0, transporte: 1, referencia: 2, descReferencia: 3, tipoLinea: 4, cantidad: 5, pegase: 6 }
});
global.registrarRetenidos_ = () => ({ total: 0, detalle: { Málaga: { nuevos: 0, repetidos: 0 }, Marbella: { nuevos: 0, repetidos: 0 }, Mijas: { nuevos: 0, repetidos: 0 } } });

const llamadasHodos = [];
global._enviarLineasHodos_ = (lineas) => { llamadasHodos.push(lineas); return { ok: [{ origen: 'Valencia', destino: 'Marbella', idsCreados: ['HODOS-1'], omitidos: [] }], fallidos: [] }; };

// Una fila CC2 (siempre va a HODOS, no se retiene): sin transporte en TOM, así
// que no queda VERDE ni MORADO -> solo la recoge _generarHodos_.
const filasTOP = [
  ['A','B','C','D','E','F','Tienda','H','I','Pegase','Pyxis','Flujo','M','N','O','Soporte','Q','R','LM','T','U','V','W'],
  ['E439','EXP-1','','','','','Marbella','','','88000111','555111','CC2','','','','SOP-1','','','','','','','']
];
let hojaTOPGuardada = null;
const hojaTOPFalsa = {
  filas: filasTOP,
  getLastColumn: () => 23,
  getLastRow: () => filasTOP.length,
  getRange: function (r, c, nf, nc) {
    return {
      getValues: () => filasTOP.slice(r - 1, r - 1 + nf),
      getDisplayValues: () => filasTOP.slice(r - 1, r - 1 + nf).map(f => f.map(String)),
      setValues: (vals) => { hojaTOPGuardada = vals; },
      setNumberFormat: function () { return this; },
      setBackgrounds: () => {},
      setFontWeight: function () { return this; },
      setBackground: function () { return this; },
      setHorizontalAlignment: function () { return this; },
      setBorder: () => {}
    };
  },
  hideColumns: () => {}
};
const hojaEANFalsa = { getLastRow: () => 1, getLastColumn: () => 5, getRange: () => ({ getValues: () => [['','','','','']] }) };
global.SpreadsheetApp = {
  getActive: () => ({
    getSheetByName: (nombre) => {
      if (nombre === 'TOP') return hojaTOPFalsa;
      if (nombre === 'EAN') return hojaEANFalsa;
      if (nombre === 'FAMILIAS TIENDA') return null;
      if (nombre === 'HODOS') return { clear: () => {}, getRange: () => ({ setValues: () => {}, setNumberFormat: () => ({ setValues: () => {} }) }), setColumnWidth: () => {} };
      if (nombre === 'TRAMECO') return null;
      return null;
    },
    getSpreadsheetTimeZone: () => 'Europe/Madrid',
    toast: () => { throw new Error('el núcleo NO debe llamar a toast()'); }
  })
};
global.Logger = { log: () => {} };

['Menu.gs', 'Retenidos.gs', 'Proceso_Arrastres.gs', 'Hodos.gs', 'ArrastresHodos.gs'].forEach(f =>
  require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const r = _procesarArrastresNucleo_();

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(!r.error, 'sin error: ' + (r.error || ''));
check(typeof r.mensaje === 'string' && r.mensaje.length > 0, 'devuelve un mensaje de texto');
check(llamadasHodos.length === 1, 'llama a _enviarLineasHodos_ una vez');
check(llamadasHodos[0].some(l => l.origen === 'Valencia' && l.tienda === 'Marbella'), 'le pasa la línea CC2 de Valencia/Marbella');
check(r.mensaje.indexOf('HODOS') !== -1, 'el mensaje incluye el resumen de HODOS');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_nucleo.js"
```

Esperado: FALLO — `_procesarArrastresNucleo_ is not defined` (y/o el `toast` de la vieja `procesarArrastres` lanzaría el `throw` del mock si llegara a ejecutarse, cosa que aún no debería pasar porque la función ni existe).

- [ ] **Paso 3: Partir `procesarArrastres` en núcleo + envoltorio**

En `Proceso_Arrastres.gs`, renombra la función `procesarArrastres` a `_procesarArrastresNucleo_` y haz estos tres cambios dentro de ella:

1. Quita el `return 'TOP vacía.'` con toast (línea 49) y dos líneas parecidas de TOM (línea 55) — pasan a devolver `{ error }`:

```javascript
  const uTOP = ultimaFilaCol_(wsTOP, 10); // J
  if (uTOP < 2) return { error: 'La hoja TOP no tiene datos.' };
```

```javascript
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
```

2. Sustituye el bloque final (desde `const hodos = _generarHodos_(...)` hasta el `return msg + ...` — líneas 300-315) por:

```javascript
  const hodos = _generarHodos_(filasFinal, tom, uTOM, iTOM, cA, cB, cG, cJ, cK, cL, cP, cS, cT);
  _marca('generar HODOS' + (hodos.catalogoDeCache ? ' (catálogo de caché)' : ' (catálogo leído de la hoja)'));

  // Envío automático a la app HODOS, agrupado por origen+tienda+expedición
  // (ver ArrastresHodos.gs). TRAMECO no se manda (sin origen).
  const envio = _enviarLineasHodos_(hodos.lineas);
  _marca('enviar a HODOS');

  let msg = 'Arrastres OK · ' + verdes.length + ' VERDE · ' + nMorado + ' LS-SIE' +
    (nSoportesBloqueados ? ' (' + nSoportesBloqueados + ' soportes LS con >2 artículos, no retenidos)' : '') +
    ' · ' + res.total + ' nuevos → ' + det +
    ' · HODOS: ' + hodos.filas + ' líneas (' + hodos.sinTransporte + ' cerámica sin transporte, ' +
    hodos.cc2 + ' CC2, ' + hodos.ls + ' LS, ' + hodos.trameco + ' de TRAMECO)';
  if (hodos.sinCatalogo) {
    msg = '⚠️ Falta la hoja CERAMICA (catálogo de LM): HODOS solo trae los de TRAMECO. · ' + msg;
  }
  if (envio.ok.length || envio.fallidos.length) {
    msg += ' · Envío HODOS: ' + envio.ok.length + ' lote(s) OK';
    if (envio.fallidos.length) {
      msg += ', ' + envio.fallidos.length + ' fallido(s) (' +
        envio.fallidos.map(f => f.origen + '/' + f.destino + ': ' + f.error).join('; ') + ')';
    }
  }

  const _total = new Date().getTime() - _t0;
  Logger.log('⏱️ procesarArrastres — TOTAL ' + _total + ' ms\n  ' + _crono.join('\n  '));
  return { mensaje: msg + ' · ' + (_total / 1000).toFixed(1) + ' s', hodos: hodos, envio: envio };
}
```

3. Renombra la declaración de la función (línea 31):

```javascript
function _procesarArrastresNucleo_() {
```

4. Al final del archivo (después del cierre de `_procesarArrastresNucleo_`, antes de `_catalogoEAN_`), añade el envoltorio:

```javascript
/**
 * Envoltorio de siempre: calcula con _procesarArrastresNucleo_ (sin UI),
 * muestra el toast y abre la impresión automática (carátula + TOP) en un
 * diálogo modal — funciona igual la llame el menú o el panel (Panel.html),
 * porque SpreadsheetApp.getUi() funciona desde cualquiera de los dos.
 * Sigue devolviendo un STRING, igual que siempre: Panel.html solo sabe
 * mostrar texto (ver run() en Panel.html), así que este contrato no cambia.
 */
function procesarArrastres() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarArrastresNucleo_();
  if (r.error) { ss.toast(r.error, '🟢 Arrastres', 8); return r.error; }
  ss.toast(r.mensaje, '🟢 Arrastres', 10);

  const imp = _htmlImpresionArrastres_();
  if (!imp.error) {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(imp.html).setWidth(1000).setHeight(750),
      '🖨️ Impresión automática'
    );
  }
  return r.mensaje;
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastres_nucleo.js"
```

Esperado: `TODO OK`.

- [ ] **Paso 5: Comprobar que no queda ninguna llamada a la función vieja**

```bash
grep -rn "procesarArrastres()" "C:/Users/30081048/Desktop/Proyectos/MacroArrastes/Menu.gs" "C:/Users/30081048/Desktop/Proyectos/MacroArrastes/Panel.html"
```

Esperado: sigue apareciendo (el menú y el panel llaman a `procesarArrastres`, que ahora es el envoltorio) — es correcto, no hay que cambiar `Menu.gs` ni `Panel.html`.

---

## Tarea 6: `procesarRecepcion` — núcleo + envoltorio (sin HODOS, sin impresión automática)

**Files:**
- Modificar: `Proceso_Recepcion.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_recepcion_nucleo.js` (nuevo)

**Recordatorio de diseño:** Recepción **no** manda nada a HODOS y **no** lleva carátula (decisión del usuario, spec §2 y §4.2). Este cambio es solo el mismo patrón núcleo/envoltorio que en la Tarea 5, para que el cajón XLSX (Tarea 9) pueda llamar al núcleo sin toast.

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_recepcion_nucleo.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = {
  HOJAS: { TOP: 'TOP', EAN: 'EAN' },
  COLORES: { VERDE_CLARO: '#d9ead3', VERDE_OSCURO: '#6aa84f', BLANCO: '#ffffff' },
  LM_SIEMPRE_VALIDO: '49009538',
  TIENDA_RECEPCION: { '036': 'Málaga', '014': 'Marbella', '279': 'Mijas' }
};
global.t_ = v => String(v == null ? '' : v).trim();
global._lmNum_ = v => v;
global.autoajustar_ = () => {};
global._leerTOMDesdeDrive_ = () => ({
  filas: [['Nº Pedido cliente','Tiene transporte','Referencia','Desc. Referencia','Tipo línea','Cantidad','Nº pedido proveedor']],
  iTOM: { pyxis: 0, transporte: 1, referencia: 2, descReferencia: 3, tipoLinea: 4, cantidad: 5, pegase: 6 }
});
global.registrarRetenidos_ = () => ({ total: 0, detalle: { Málaga: { nuevos: 0, repetidos: 0 }, Marbella: { nuevos: 0, repetidos: 0 }, Mijas: { nuevos: 0, repetidos: 0 } } });

const filasTOP = [new Array(39).fill('')];
filasTOP[0][33] = 'transporte'; // AH cabecera, sin usar
const hojaTOPFalsa = {
  getLastRow: () => filasTOP.length,
  getLastColumn: () => 39,
  getRange: (r, c, nf, nc) => ({
    getValues: () => filasTOP.slice(r - 1, r - 1 + nf),
    setValues: () => {},
    setBackgrounds: () => {},
    setNumberFormat: function () { return this; },
    setBackground: function () { return this; },
    setFontColor: function () { return this; },
    setFontWeight: function () { return this; },
    setHorizontalAlignment: function () { return this; },
    setBorder: () => {}
  }),
  clearContents: () => {},
  hideColumns: () => {}
};
const hojaEANFalsa = { getLastRow: () => 1, getRange: () => ({ getValues: () => [['','','','','']] }) };
global.SpreadsheetApp = {
  getActive: () => ({
    getSheetByName: (n) => (n === 'TOP' ? hojaTOPFalsa : hojaEANFalsa),
    toast: () => { throw new Error('el núcleo NO debe llamar a toast()'); }
  })
};
global.Logger = { log: () => {} };

['Proceso_Recepcion.gs'].forEach(f =>
  require('vm').runInThisContext(fs.readFileSync(path + f, 'utf8'), { filename: f }));

const r = _procesarRecepcionNucleo_();

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };
check(!r.error, 'sin error con TOP mínima: ' + (r.error || ''));
check(typeof r.mensaje === 'string', 'devuelve un mensaje de texto');
check(typeof procesarRecepcion === 'function', 'el envoltorio procesarRecepcion existe');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_recepcion_nucleo.js"
```

Esperado: FALLO — `_procesarRecepcionNucleo_ is not defined`.

- [ ] **Paso 3: Partir `procesarRecepcion`**

Renombra `function procesarRecepcion()` a `function _procesarRecepcionNucleo_()`. Cambia las dos salidas tempranas con toast (líneas 17 y 31):

```javascript
  const uTOP = wsTOP.getLastRow();
  if (uTOP < 2) return { error: 'La hoja TOP no tiene datos.' };
```

```javascript
  const tomDatos = _leerTOMDesdeDrive_();
  if (tomDatos.error) return { error: tomDatos.error };
```

Sustituye el final (desde `let msg = 'Recepción OK...'` hasta `return msg;`, líneas 149-153) por:

```javascript
  let msg = 'Recepción OK · ' + verdes + ' VERDE · ' + res.total + ' nuevos\n' + det;
  if (sinMapa) msg += '\nCódigos sin tienda: ' + sinMapa;
  Logger.log(msg);
  return { mensaje: msg };
}

/** Envoltorio de siempre: calcula con _procesarRecepcionNucleo_ y hace el toast. */
function procesarRecepcion() {
  const ss = SpreadsheetApp.getActive();
  const r = _procesarRecepcionNucleo_();
  if (r.error) { ss.toast(r.error, '📥 Recepción', 8); return r.error; }
  ss.toast(r.mensaje, '📥 Recepción', 10);
  return r.mensaje;
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_recepcion_nucleo.js"
```

Esperado: `TODO OK`.

---

## Tarea 7: Cajón CSV de Valencia/Torija

**Files:**
- Crear: `ArrastreCsv.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_arrastre_csv.js` (nuevo)

- [ ] **Paso 1: Escribir el test que falla**

Usa los fragmentos reales de los CSV de referencia (mismos que en el spec §4.1), con Windows-1252 simulado con `Buffer` de Node (no hay `Utilities.newBlob`/`getDataAsString` reales fuera de Apps Script, así que se mockean produciendo el texto YA descodificado — lo que se comprueba aquí es el MAPEO de columnas y el filtrado, no la descodificación en sí, que es una sola línea de API de Apps Script sin lógica propia que testear).

```javascript
// C:\Users\30081048\Desktop\skills\test_arrastre_csv.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = { HOJAS: { TOP: 'TOP' }, ORIGENES: { 'E439': 'Valencia', 'E431': 'Torija' } };
global.t_ = v => String(v == null ? '' : v).trim();
global.Utilities = {
  base64Decode: (b64) => Buffer.from(b64, 'base64'),
  newBlob: (bytes) => ({ getDataAsString: (charset) => bytes.toString('latin1') }), // ascii puro en este test, basta latin1
  parseCsv: (texto, sep) => texto.split(/\r?\n/).filter(l => l.length).map(l => l.split(sep))
};

const cabeceraCsv = 'ALM_ORIGEN;EXPEDICION;RUTA;ACTIVIDAD;ALM_DEST;TIENDA;NOMBRE;PROVEEDOR; PEDIDO_OMS;PEDIDO_PEG;PEDIDO_PYX;FLUJO;CMP;SSCC_CMP;EMB_CMP;SOPORTE;SSCC;      EMBALAJE;PRODUCTO;DESCRIPCION;UNIDADES;P_C';
const filaBuena = 'E439;02828945;4670;439;E467;E014;MARBELLA;E439;33551922;99143242;973749;CC;;;;13368098;8424019491336809;EUR;C18133052;90323676;PAV CERES;3;C';
const filaCorta = 'E439;02828945;4670'; // menos de 23 campos -> se descarta

let hojaTOPGuardada = null;
const hojaTOPFalsa = {
  getLastRow: () => 5, getLastColumn: () => 26,
  getRange: (r, c, nf, nc) => ({
    clear: () => {},
    setNumberFormat: function () { return this; },
    setValues: (vals) => { hojaTOPGuardada = vals; },
    setFontWeight: function () { return this; }
  })
};
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: () => hojaTOPFalsa }) };
global.procesarArrastres = () => 'Arrastres OK (llamado por el cajón)';

require('vm').runInThisContext(fs.readFileSync(path + 'ArrastreCsv.gs', 'utf8'), { filename: 'ArrastreCsv.gs' });

const csv = cabeceraCsv + '\r\n' + filaBuena + '\r\n' + filaCorta + '\r\n';
const base64 = Buffer.from(csv, 'latin1').toString('base64');

const r = procesarCsvArrastre(base64, 'Q_439ARR.CSV');

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(!r.error, 'sin error: ' + (r.error || ''));
check(r.plataforma === 'Valencia', 'deduce la plataforma (Valencia) de ALM_ORIGEN');
check(r.filasDescartadas === 1, 'descarta la fila corta (menos de 23 campos) y lo cuenta');
check(!!hojaTOPGuardada, 'escribe algo en TOP');
check(hojaTOPGuardada[1][0] === 'E439', 'columna A = ALM_ORIGEN tal cual (lo traduce procesarArrastres, no el cajón)');
check(hojaTOPGuardada[1][6] === 'MARBELLA', 'columna G = NOMBRE (Tienda)');
check(hojaTOPGuardada[1][9] === '99143242', 'columna J = PEDIDO_PEG (Pegase)');
check(hojaTOPGuardada[1][18] === 'C18133052', 'columna S = campo 18 (LM), NO el 19 pese a la cabecera incompleta');
check(hojaTOPGuardada[1].length === 23, 'fila de 23 columnas (A..W)');
check(r.resumenProceso === 'Arrastres OK (llamado por el cajón)', 'encadena con procesarArrastres()');

const csvSinOrigen = cabeceraCsv + '\r\n' + filaBuena.replace('E439', 'E999') + '\r\n';
const r2 = procesarCsvArrastre(Buffer.from(csvSinOrigen, 'latin1').toString('base64'), 'Q_999.CSV');
check(!!r2.error, 'ALM_ORIGEN desconocido (E999) da error');
check(hojaTOPGuardada[1][0] === 'E439', 'y NO ha vuelto a tocar TOP (sigue con los datos del caso anterior)');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastre_csv.js"
```

Esperado: FALLO — `procesarCsvArrastre is not defined`.

- [ ] **Paso 3: Escribir `ArrastreCsv.gs`**

```javascript
/**
 * ARRASTRES — CSV AUTOMÁTICO (Valencia / Torija)
 * Sustituye el pegado manual: el CSV que manda Leroy Merlin (Q_439ARR.CSV,
 * Q_431ARR.CSV) encaja columna a columna con TOP (A..W, 23 columnas) — ver
 * docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md, sección 4.1.
 *
 * Tres trampas ya comprobadas contra archivos reales:
 *   1. La cabecera del export trae 22 nombres pero las filas traen 23 campos
 *      (falta un título entre EMBALAJE y PRODUCTO) -> se lee por POSICIÓN,
 *      nunca por nombre de cabecera, y se descarta la fila de cabecera entera.
 *   2. El archivo es Windows-1252, no UTF-8 (hay "PELDAÑOS", "16Ø" en Torija).
 *   3. El campo 18 (sin título) es el LM real, no el 19 (PRODUCTO).
 */

const ARRASTRE_CSV_ANCHO_ESPERADO = 23;

/**
 * Vuelca el CSV en TOP y llama a procesarArrastres() (que ya calcula, manda a
 * HODOS y abre la impresión). Devuelve { plataforma, filasDescartadas,
 * resumenProceso } o { error } si no reconoce ALM_ORIGEN — en ese caso NO
 * toca TOP.
 */
function procesarCsvArrastre(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, 'text/csv', nombreArchivo);
  const texto = blob.getDataAsString('Windows-1252');

  let todas;
  try {
    todas = Utilities.parseCsv(texto, ';');
  } catch (e) {
    return { error: 'No se puede leer el archivo como CSV (' + e.message + ').' };
  }
  if (todas.length < 2) return { error: 'El archivo está vacío o solo trae la cabecera.' };

  const datos = todas.slice(1); // la cabecera del export viene incompleta: se descarta entera
  const buenas = [], descartadas = [];
  datos.forEach(f => { (f.length === ARRASTRE_CSV_ANCHO_ESPERADO ? buenas : descartadas).push(f); });
  if (!buenas.length) return { error: 'Ninguna fila tiene las ' + ARRASTRE_CSV_ANCHO_ESPERADO + ' columnas esperadas.' };

  const codigo = t_(buenas[0][0]);
  const plataforma = CFG.ORIGENES[codigo];
  if (!plataforma) return { error: 'Código de plataforma no reconocido: "' + codigo + '" (columna ALM_ORIGEN).' };

  const ANCHO = ARRASTRE_CSV_ANCHO_ESPERADO;
  const cabeceraProvisional = new Array(ANCHO).fill(''); // procesarArrastres la sobrescribe en su paso 6
  const matriz = [cabeceraProvisional].concat(buenas);

  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();

  const rango = wsTOP.getRange(1, 1, matriz.length, ANCHO);
  rango.setNumberFormat('@'); // texto: no perder ceros a la izquierda ni notación científica
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, ANCHO).setFontWeight('bold');

  const resumenProceso = procesarArrastres();
  return { plataforma: plataforma, filasDescartadas: descartadas.length, resumenProceso: resumenProceso };
}

/** Abre el diálogo de subida del CSV (menú y panel). */
function abrirArrastreCsv() {
  const html = HtmlService.createHtmlOutputFromFile('ArrastreCsvForm').setWidth(480).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Arrastres: CSV → todo');
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_arrastre_csv.js"
```

Esperado: `TODO OK`.

---

## Tarea 8: Diálogo del cajón CSV + entrada de menú

**Files:**
- Crear: `ArrastreCsvForm.html`
- Modificar: `Menu.gs`

No lleva test automático (es HTML/JS de cliente, sin banco de pruebas en este proyecto, igual que `MecoZipForm.html`) — se verifica a mano en la Tarea 11.

- [ ] **Paso 1: Crear `ArrastreCsvForm.html`**

Mismo patrón que `MecoZipForm.html`, adaptado: el resultado ya es un STRING (`resumenProceso`, que viene de `procesarArrastres()`), así que no hace falta abrir ninguna ventana — la impresión ya se abrió sola en un diálogo modal (Tarea 5).

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
  <p>Selecciona el CSV de Valencia o Torija (ej. <code>Q_439ARR.CSV</code>, <code>Q_431ARR.CSV</code>):</p>
  <input type="file" id="archivo" accept=".csv">
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
        const base64 = lector.result.split(',')[1];
        google.script.run
          .withSuccessHandler(mostrarResultado)
          .withFailureHandler(function (err) { estado.innerHTML = '<span class="error">' + err.message + '</span>'; })
          .procesarCsvArrastre(base64, archivo.name);
      };
      lector.readAsDataURL(archivo);
    }

    function mostrarResultado(r) {
      const estado = document.getElementById('estado');
      if (r.error) { estado.innerHTML = '<span class="error">' + r.error + '</span>'; return; }
      let txt = '<span class="ok">' + r.plataforma + ' procesada.</span><br>' + r.resumenProceso;
      if (r.filasDescartadas) txt += '<br>(' + r.filasDescartadas + ' fila(s) descartada(s) por ancho incorrecto)';
      estado.innerHTML = txt;
    }
  </script>
</body>
</html>
```

- [ ] **Paso 2: Añadir la entrada de menú**

En `Menu.gs`, dentro del submenú `① PROCESAR`, justo debajo de la de Meco:

```javascript
      .addItem('📦  Meco: ZIP → CCM + HODOS', 'abrirMecoZip')
      .addItem('📥  Arrastres: CSV → todo (Valencia/Torija)', 'abrirArrastreCsv')
      .addItem('🟢  Arrastres (Valencia · Torija · Antequera)', 'procesarArrastres')
```

- [ ] **Paso 3: Comprobar sintaxis del HTML nuevo**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/ArrastreCsvForm.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
try { new Function(m[1]); console.log('JS OK'); } catch (e) { console.log('ERROR: ' + e.message); process.exit(1); }
"
```

Esperado: `JS OK`.

---

## Tarea 9: Cajón XLSX de Recepción

**Files:**
- Crear: `RecepcionXlsx.gs`
- Test: `C:\Users\30081048\Desktop\skills\test_recepcion_xlsx.js` (nuevo)

**Las dos trampas de este archivo** (spec §4.2): los números llegan en coma flotante cruda (`8.1402761E7` en vez de `81402761`), y la tienda (`014`) puede perder el cero a la izquierda al convertir el xlsx.

- [ ] **Paso 1: Escribir el test que falla**

```javascript
// C:\Users\30081048\Desktop\skills\test_recepcion_xlsx.js
const fs = require('fs');
const path = 'C:/Users/30081048/Desktop/Proyectos/MacroArrastes/';

global.CFG = { HOJAS: { TOP: 'TOP' } };
global.t_ = v => String(v == null ? '' : v).trim();
global.procesarRecepcion = () => 'Recepción OK (llamado por el cajón)';

const cabecera = new Array(36).fill('');
cabecera[0] = 'Pedido'; cabecera[2] = 'Tienda'; cabecera[33] = 'Re-Tránsito';
const filaBuena = new Array(36).fill('');
filaBuena[0] = 81402761;      // número crudo, como llega del xlsx real
filaBuena[2] = 14;            // tienda SIN cero a la izquierda tras la conversión
filaBuena[33] = 'Si';
const filaMala = new Array(36).fill(''); // fila totalmente vacía, se descarta
const filasXlsx = [cabecera, filaBuena, filaMala];

global._leerXlsxComoValores_ = () => filasXlsx;

let hojaTOPGuardada = null;
const hojaTOPFalsa = {
  getLastRow: () => 5, getLastColumn: () => 39,
  getRange: () => ({
    clear: () => {},
    setNumberFormat: function () { return this; },
    setValues: (vals) => { hojaTOPGuardada = vals; },
    setFontWeight: function () { return this; }
  })
};
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: () => hojaTOPFalsa }) };

require('vm').runInThisContext(fs.readFileSync(path + 'RecepcionXlsx.gs', 'utf8'), { filename: 'RecepcionXlsx.gs' });

const r = procesarXlsxRecepcion('QkFTRTY0', 'facturacion-informe.xlsx');

let ok = true;
const check = (cond, label) => { console.log((cond ? 'OK  ' : 'FALLO ') + label); if (!cond) ok = false; };

check(!r.error, 'sin error: ' + (r.error || ''));
check(hojaTOPGuardada[1][0] === '81402761', 'Pedido sin notación científica ("81402761", no "8.1402761E7")');
check(hojaTOPGuardada[1][2] === '014', 'Tienda con el cero a la izquierda ("014", no "14")');
check(hojaTOPGuardada[1][33] === 'Si', 'Re-Tránsito en columna AH (33)');
check(r.filas === 1, 'cuenta 1 fila útil (la vacía no cuenta)');
check(r.resumenProceso === 'Recepción OK (llamado por el cajón)', 'encadena con procesarRecepcion()');

const cabeceraMala = new Array(36).fill('');
cabeceraMala[0] = 'OtraColumna'; // sin "Pedido" en 0 -> formato cambiado
global._leerXlsxComoValores_ = () => [cabeceraMala, filaBuena];
const r2 = procesarXlsxRecepcion('QkFTRTY0', 'otro.xlsx');
check(!!r2.error, 'cabecera sin "Pedido"/"Re-Tránsito" en su sitio -> error claro, no sigue');
check(hojaTOPGuardada[1][0] === '81402761', 'y NO ha vuelto a tocar TOP');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLOS'));
```

- [ ] **Paso 2: Lanzar y ver que falla**

```bash
node "C:/Users/30081048/Desktop/skills/test_recepcion_xlsx.js"
```

Esperado: FALLO — `procesarXlsxRecepcion is not defined`.

- [ ] **Paso 3: Escribir `RecepcionXlsx.gs`**

```javascript
/**
 * RECEPCIÓN — XLSX AUTOMÁTICO
 * El informe de facturación (facturacion-informe-*.xlsx) encaja columna a
 * columna con TOP: Pedido (0) -> A, Tienda (2) -> C, Re-Tránsito (33) -> AH.
 * Ver docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md, 4.2.
 *
 * Dos trampas comprobadas contra el archivo real:
 *   1. Los números llegan crudos ("8.1402761E7"), no formateados como al
 *      pegar desde Excel -> hay que pasarlos a entero como texto.
 *   2. La tienda ("014") puede perder el cero a la izquierda al convertir el
 *      xlsx a hoja de cálculo -> se rellena a 3 dígitos.
 *
 * SIN carátula y SIN envío a HODOS (decisión del usuario): Recepción es
 * retención en plataforma, no arrastre.
 */

const RECEPCION_XLSX_ANCHO = 36;
const RECEPCION_XLSX_COL_PEDIDO = 0;
const RECEPCION_XLSX_COL_TIENDA = 2;
const RECEPCION_XLSX_COL_RETRANSITO = 33;

/** "8.1402761E7" / 81402761 (número) / "81402761" -> "81402761". No numérico: se deja igual. */
function _enteroTextoRecepcion_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (!isFinite(n)) return t_(v);
  return String(Math.round(n));
}

/** 14 / "14" / "014" -> "014". No numérico: se deja igual (t_ recorta espacios). */
function _tiendaTresDigitos_(v) {
  const s = t_(v);
  if (s === '') return '';
  const n = Number(s);
  if (!isFinite(n)) return s;
  return ('000' + Math.round(n)).slice(-3);
}

/**
 * Vuelca el XLSX en TOP y llama a procesarRecepcion(). Devuelve
 * { filas, resumenProceso } o { error } si la cabecera no trae "Pedido" en la
 * columna 0 o "Re-Tránsito" en la 33 (señal de que Leroy Merlin cambió el
 * informe) — en ese caso NO toca TOP.
 */
function procesarXlsxRecepcion(base64, nombreArchivo) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, MimeType.MICROSOFT_EXCEL, nombreArchivo);
  const filasXlsx = _leerXlsxComoValores_(blob);
  if (!filasXlsx || filasXlsx.length < 2) return { error: 'El archivo está vacío o solo trae la cabecera.' };

  const cab = filasXlsx[0];
  if (t_(cab[RECEPCION_XLSX_COL_PEDIDO]) !== 'Pedido' || t_(cab[RECEPCION_XLSX_COL_RETRANSITO]) !== 'Re-Tránsito') {
    return { error: 'El informe ha cambiado de formato: falta "Pedido" en la columna A o "Re-Tránsito" en la AH.' };
  }

  const filas = [];
  for (let i = 1; i < filasXlsx.length; i++) {
    const f = filasXlsx[i];
    if (t_(f[RECEPCION_XLSX_COL_PEDIDO]) === '') continue; // fila vacía: se descarta
    const fila = new Array(RECEPCION_XLSX_ANCHO).fill('');
    for (let c = 0; c < RECEPCION_XLSX_ANCHO && c < f.length; c++) fila[c] = t_(f[c]);
    fila[RECEPCION_XLSX_COL_PEDIDO] = _enteroTextoRecepcion_(f[RECEPCION_XLSX_COL_PEDIDO]);
    fila[RECEPCION_XLSX_COL_TIENDA] = _tiendaTresDigitos_(f[RECEPCION_XLSX_COL_TIENDA]);
    filas.push(fila);
  }
  if (!filas.length) return { error: 'Ninguna fila trae Pedido.' };

  const cabeceraProvisional = new Array(RECEPCION_XLSX_ANCHO).fill(''); // procesarRecepcion pone sus propios títulos
  const matriz = [cabeceraProvisional].concat(filas);

  const ss = SpreadsheetApp.getActive();
  const wsTOP = ss.getSheetByName(CFG.HOJAS.TOP);
  const lastR = wsTOP.getLastRow();
  const lastC = Math.max(wsTOP.getLastColumn(), RECEPCION_XLSX_ANCHO);
  if (lastR > 0) wsTOP.getRange(1, 1, lastR, lastC).clear();

  const rango = wsTOP.getRange(1, 1, matriz.length, RECEPCION_XLSX_ANCHO);
  rango.setNumberFormat('@');
  rango.setValues(matriz);
  wsTOP.getRange(1, 1, 1, RECEPCION_XLSX_ANCHO).setFontWeight('bold');

  const resumenProceso = procesarRecepcion();
  return { filas: filas.length, resumenProceso: resumenProceso };
}

/** Abre el diálogo de subida del XLSX (menú y panel). */
function abrirRecepcionXlsx() {
  const html = HtmlService.createHtmlOutputFromFile('RecepcionXlsxForm').setWidth(480).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Recepción: XLSX → todo');
}
```

- [ ] **Paso 4: Lanzar el test y ver que pasa**

```bash
node "C:/Users/30081048/Desktop/skills/test_recepcion_xlsx.js"
```

Esperado: `TODO OK`.

---

## Tarea 10: Diálogo del cajón XLSX + entrada de menú

**Files:**
- Crear: `RecepcionXlsxForm.html`
- Modificar: `Menu.gs`

- [ ] **Paso 1: Crear `RecepcionXlsxForm.html`**

Igual que `ArrastreCsvForm.html` (Tarea 8), cambiando el tipo de archivo y la función llamada:

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
  <p>Selecciona el XLSX de facturación (ej. <code>facturacion-informe-07-09-2026.xlsx</code>):</p>
  <input type="file" id="archivo" accept=".xlsx">
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
        const base64 = lector.result.split(',')[1];
        google.script.run
          .withSuccessHandler(mostrarResultado)
          .withFailureHandler(function (err) { estado.innerHTML = '<span class="error">' + err.message + '</span>'; })
          .procesarXlsxRecepcion(base64, archivo.name);
      };
      lector.readAsDataURL(archivo);
    }

    function mostrarResultado(r) {
      const estado = document.getElementById('estado');
      if (r.error) { estado.innerHTML = '<span class="error">' + r.error + '</span>'; return; }
      estado.innerHTML = '<span class="ok">' + r.filas + ' fila(s) volcadas.</span><br>' + r.resumenProceso;
    }
  </script>
</body>
</html>
```

- [ ] **Paso 2: Añadir la entrada de menú**

En `Menu.gs`, dentro del submenú `① PROCESAR`, debajo de la del CSV de arrastres:

```javascript
      .addItem('📥  Arrastres: CSV → todo (Valencia/Torija)', 'abrirArrastreCsv')
      .addItem('📥  Recepción: XLSX → todo', 'abrirRecepcionXlsx')
      .addItem('🟢  Arrastres (Valencia · Torija · Antequera)', 'procesarArrastres')
```

- [ ] **Paso 3: Comprobar sintaxis**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('C:/Users/30081048/Desktop/Proyectos/MacroArrastes/RecepcionXlsxForm.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
try { new Function(m[1]); console.log('JS OK'); } catch (e) { console.log('ERROR: ' + e.message); process.exit(1); }
"
```

---

## Tarea 11: Desplegar y verificar

**Files:** ninguno (despliegue)

- [ ] **Paso 1: Lanzar TODOS los tests nuevos y los que tocan archivos modificados**

```bash
for f in test_arrastres_hodos_agrupacion test_arrastres_hodos_envio test_arrastres_meco_agrupacion_expedicion test_arrastres_impresion test_arrastres_nucleo test_recepcion_nucleo test_arrastre_csv test_recepcion_xlsx test_meco_hodos_webhook test_meco_zip_orquestador test_meco_albaran test_meco_zip_localizar test_meco_hodos_xlsx; do
  echo "=== $f ==="
  node "C:/Users/30081048/Desktop/skills/$f.js" 2>&1 | tail -3
done
```

Esperado: `TODO OK` en cada uno.

- [ ] **Paso 2: Comprobar sintaxis de todos los `.gs` tocados o nuevos**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/MacroArrastes"
for f in Hodos.gs ArrastresHodos.gs MecoHodos.gs Impresion.gs Proceso_Arrastres.gs Proceso_Recepcion.gs ArrastreCsv.gs RecepcionXlsx.gs Menu.gs; do
  node -e "new Function(require('fs').readFileSync('$f','utf8')); console.log('$f OK')" || echo "$f: ERROR DE SINTAXIS"
done
```

- [ ] **Paso 3: Traer lo que haya en el editor antes de subir**

```bash
cd "C:/Users/30081048/Desktop/Proyectos/MacroArrastes"
clasp pull
```

Compara los archivos que has tocado — si `clasp pull` ha sobrescrito alguno (mismo riesgo que ya pasó en el Plan 1 con `Index.html` de `hodos`), vuelve a aplicar los cambios de esa tarea antes de continuar:

```bash
grep -c "lineas.push" Hodos.gs
grep -c "_enviarLineasHodos_" ArrastresHodos.gs Proceso_Arrastres.gs
grep -c "_htmlImpresionArrastres_" Impresion.gs
grep -c "_procesarArrastresNucleo_" Proceso_Arrastres.gs
grep -c "_procesarRecepcionNucleo_" Proceso_Recepcion.gs
grep -c "abrirArrastreCsv\|abrirRecepcionXlsx" Menu.gs
```

Esperado: todos mayores que 0.

- [ ] **Paso 4: Subir**

```bash
clasp push -f
```

- [ ] **Paso 5: Verificar el menú**

Abre el Sheet, menú `📦 Arrastres` → `① PROCESAR`. Deben aparecer, en este orden: Antequera, Meco (ZIP), **Arrastres: CSV → todo**, **Recepción: XLSX → todo**, Arrastres (el botón verde de siempre), Marcar pedidos a retener, Meco — aplicar formato.

- [ ] **Paso 6: Probar el cajón CSV con un archivo real**

Sube uno de los CSV de referencia (`Q_439ARR.CSV` o `Q_431ARR.CSV`). Comprueba:
- TOP queda escrita con la plataforma correcta.
- Se abre un diálogo de impresión con carátula + tabla (puede tardar un segundo).
- En HODOS (app), la pestaña de esa plataforma (Valencia o Torija) muestra las etiquetas nuevas.
- Vuelve a subir el MISMO archivo: la pestaña de HODOS no debe duplicar nada (el resumen del cajón debe seguir diciendo "Arrastres OK", y en Supabase las filas con esa expedición no se repiten).

- [ ] **Paso 7: Probar el cajón XLSX de Recepción**

Sube el `facturacion-informe-*.xlsx`. Comprueba que TOP queda escrita y que **no** se abre ningún diálogo de impresión (por diseño) y que **no** aparecen etiquetas nuevas en HODOS (por diseño).

- [ ] **Paso 8: Probar que el flujo manual de siempre sigue igual**

Pega un CSV a mano en TOP (como se hacía antes) y pulsa el menú "🟢 Arrastres" directamente, sin usar el cajón. Debe comportarse EXACTAMENTE igual que hasta hoy, con la única diferencia de que ahora manda a HODOS y abre la impresión sola.

---

## Autorrevisión del plan

**Cobertura del spec:**
- §5.B (origen+expedición por línea, envío agrupado, antiduplicado por expedición) → Tareas 1, 2, 3, 5.
- §5.C (impresión automática, sin tocar `htmlImprimirTOP`) → Tareas 4, 5.
- §4.1 y §5.D (cajón CSV, sus tres trampas) → Tareas 7, 8.
- §4.2 y §5.D (cajón XLSX, sus dos trampas, sin carátula ni HODOS) → Tareas 9, 10.
- §5.E (núcleo/envoltorio) → Tareas 5, 6 (la parte que le toca a este plan; el `doGet`/web queda para el Plan 3).
- Regla "MECO debe cargarse completo" NO se extiende a estas plataformas → no se ha tocado esa regla en ningún sitio de este plan (sigue viviendo solo en `hodos/Backend.gs`, que no se toca aquí).
- TRAMECO no se manda a HODOS → Tarea 1, paso 4 (`origen: null`) y Tarea 2 (`_agruparLineasHodosPorLote_` descarta `!l.origen`).

**Placeholders:** ninguno — cada paso de código trae la implementación completa, no fragmentos con "..." salvo cuando se indica explícitamente "sustituye el bloque X por Y" citando el bloque real leído del archivo.

**Consistencia de tipos:** `_generarHodos_` devuelve `lineas` (no `salidaConOrigen` ni otro nombre) en la Tarea 1, y la Tarea 5 lee `hodos.lineas` — coincide. `_enviarLineasHodos_` (Tarea 2) es el nombre usado también en la Tarea 3 (Meco) y la Tarea 5 (arrastres) — coincide. `_procesarArrastresNucleo_`/`_procesarRecepcionNucleo_` son los nombres usados consistentemente en sus propias tareas y en el paso de verificación final.
