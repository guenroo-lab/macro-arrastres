# Plan 1 de 3 — HODOS: pestañas de arrastres y API de alta de etiquetas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar la app HODOS lista para recibir etiquetas de las cuatro plataformas de arrastre (Meco, Valencia, Torija, Antequera), con una pestaña por plataforma agrupadas bajo el rótulo ARRASTRES, y con las dos pestañas existentes renombradas.

**Architecture:** Se generaliza lo que hoy es específico de Meco. El trío de funciones de pendientes pasa a estar parametrizado por origen; el webhook `registrarLoteMeco` pasa a ser `registrarLoteArrastre` con un campo `origen`, conservando el nombre viejo como alias. Se añade a la tabla `etiquetas` de Supabase una columna `expedicion` que permite distinguir dos entregas del mismo pedido el mismo día, que es la clave del control de duplicados.

**Tech Stack:** Google Apps Script (V8, sintaxis ES5 en este proyecto), Supabase/PostgREST, `node --test` con `node:vm` para las pruebas, `clasp` para desplegar.

**Spec:** `MacroArrastes/docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md`, secciones 5.A y 5.B.

**Alcance de este plan:** solo el proyecto `hodos`. Al terminarlo, HODOS tiene las cuatro pestañas y una API que acepta lotes de cualquier plataforma, pero todavía nadie se la llama: `MacroArrastres` no se toca aquí. Eso es el Plan 2.

---

## Contexto que el implementador necesita

**Ninguno de los dos proyectos es un repositorio git.** No hay pasos de commit. El punto de control de cada tarea es "las pruebas pasan". El despliegue ocurre solo en la Tarea 7.

**Cómo se lanzan las pruebas.** No hay `package.json`. Desde `C:\Users\30081048\Desktop\Proyectos\hodos`:

```bash
node --test
```

Las pruebas cargan los `.gs` reales dentro de un contexto de `node:vm` con los servicios de Google simulados. Un `.gs` cargado así **sobrescribe** cualquier función del mismo nombre que se hubiera puesto antes en el contexto: no se puede simular una función que el propio archivo declara.

**Cuidado con `deepStrictEqual` entre realms.** Las pruebas existentes pasan los objetos por `JSON.parse(JSON.stringify(...))` (la función `aRealmLocal`) antes de comparar. Hay que seguir haciéndolo. Efecto lateral útil: las claves con valor `undefined` desaparecen en ese viaje, y por eso añadir `expedicion` al mapeo de lectura no rompe las pruebas que ya existen.

**Todo el proyecto está en ES5** (`var`, `function`, sin flechas ni plantillas). Hay que seguir el estilo del archivo que se toca.

**Los comentarios y el código se escriben en castellano**, como el resto del proyecto.

---

## Estructura de archivos

| Archivo | Responsabilidad | Qué se hace |
|---|---|---|
| Supabase, tabla `etiquetas` | Almacén de etiquetas | Se le añade la columna `expedicion` |
| `EstructuraSheets.gs` | Traducción snake_case ↔ camelCase | Dos líneas nuevas para `expedicion` |
| `Backend.gs` | `registrarLote`, alta de etiquetas | Propaga `expedicion` al objeto de la fila |
| `IntegracionIncpc.gs` | Todas las integraciones externas y las pestañas de pendientes | Familia de arrastres, webhook generalizado, arreglo del filtro de INCPC |
| `Index.html` | Interfaz completa | Renombres, bloque ARRASTRES, cuatro vistas, JS parametrizado |
| `test/estructuraSheets.test.js` | Pruebas del mapeo | Dos pruebas nuevas |
| `test/integracionArrastres.test.js` | Pruebas de la familia de arrastres | Archivo nuevo |

---

## Tarea 1: Columna `expedicion` en Supabase

Es el único paso que toca la base de datos de producción. Es aditivo y anulable: las etiquetas existentes se quedan con el valor nulo y ninguna consulta actual cambia de comportamiento.

**Files:**
- Modificar: tabla `public.etiquetas` en Supabase (proyecto de HODOS)

- [ ] **Paso 1: Comprobar cuántas etiquetas hay ahora**

En el editor SQL de Supabase:

```sql
select count(*) as total, count(expedicion) as con_expedicion
from public.etiquetas;
```

Esperado: error `column "expedicion" does not exist`. Ese error confirma que la columna todavía no está. Anota el total con esta otra consulta:

```sql
select count(*) from public.etiquetas;
```

- [ ] **Paso 2: Añadir la columna**

```sql
alter table public.etiquetas add column if not exists expedicion text;
```

- [ ] **Paso 3: Comprobar que no se ha perdido nada**

```sql
select count(*) as total, count(expedicion) as con_expedicion
from public.etiquetas;
```

Esperado: `total` igual al número anotado en el paso 1, y `con_expedicion` igual a 0.

- [ ] **Paso 4: Comprobar que la app sigue funcionando**

Abre la app HODOS en el navegador y verifica, sin cambiar nada:
- La pestaña Buscar devuelve resultados.
- La pestaña Pendientes carga.
- Registrar un lote de prueba con un pedido inventado funciona y aparece en Buscar.

Si algo de esto falla, **para aquí**: la columna se quita con `alter table public.etiquetas drop column expedicion;` y hay que averiguar por qué antes de seguir.

- [ ] **Paso 5: Borrar la etiqueta de prueba**

Búscala en el Buscador Interno por su número de pedido y bórrala desde la propia app.

---

## Tarea 2: `expedicion` en el mapeo de Supabase

**Files:**
- Modificar: `hodos/EstructuraSheets.gs:3-45`
- Test: `hodos/test/estructuraSheets.test.js`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade al final de `test/estructuraSheets.test.js`:

```javascript
test('filaEtiquetaDesdeSupabase_ mapea expedicion', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const r = ctx.filaEtiquetaDesdeSupabase_({ id_unico: 'HODOS-000001', expedicion: '02828945' });
  assert.strictEqual(r.expedicion, '02828945');
});

test('filaEtiquetaHaciaSupabase_ mapea expedicion, incluida cadena vacía y null', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: '02828945' }).expedicion, '02828945');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: '' }).expedicion, '');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: null }).expedicion, null);
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({}).expedicion, undefined);
});
```

La última comprobación de cada prueba es la importante: un objeto que no trae `expedicion` no debe generar la clave, porque si no, las altas hechas desde la pantalla normal empezarían a escribir la columna sin necesidad.

- [ ] **Paso 2: Lanzar las pruebas y ver que fallan**

Ejecuta desde `C:\Users\30081048\Desktop\Proyectos\hodos`:

```bash
node --test test/estructuraSheets.test.js
```

Esperado: FALLO en las dos pruebas nuevas, con `undefined !== '02828945'`. Las cinco pruebas que ya existían deben seguir pasando.

- [ ] **Paso 3: Añadir el campo al mapeo de lectura**

En `EstructuraSheets.gs`, en `filaEtiquetaDesdeSupabase_`, cambia la última línea del objeto que devuelve:

```javascript
    razonFlujo: f.razon_flujo,
    pendienteImpresionIncpc: f.pendiente_impresion_incpc,
    expedicion: f.expedicion
  };
}
```

- [ ] **Paso 4: Añadir el campo al mapeo de escritura**

En la misma función `filaEtiquetaHaciaSupabase_`, justo antes del `return fila;`:

```javascript
  if (obj.pendienteImpresionIncpc !== undefined) fila.pendiente_impresion_incpc = obj.pendienteImpresionIncpc;
  if (obj.expedicion !== undefined) fila.expedicion = obj.expedicion;
  return fila;
}
```

- [ ] **Paso 5: Lanzar las pruebas y ver que pasan**

```bash
node --test test/estructuraSheets.test.js
```

Esperado: las siete pruebas en verde.

- [ ] **Paso 6: Lanzar la suite entera**

```bash
node --test
```

Esperado: todo en verde. Si `estructura-sheets.test.js` (el otro archivo, con guion) falla por comparar el objeto completo, corrige ese archivo añadiendo `expedicion: undefined` al esperado — **no** deshagas el cambio.

---

## Tarea 3: `registrarLote` propaga la expedición

**Files:**
- Modificar: `hodos/Backend.gs:46-53`
- Test: `hodos/test/integracionArrastres.test.js` (se crea en la Tarea 5; aquí basta la comprobación manual del paso 3)

- [ ] **Paso 1: Añadir el campo al objeto de la fila**

En `Backend.gs`, dentro de `registrarLote`, en el `soportes.map`:

```javascript
  var filas = soportes.map(function (s, i) {
    return {
      idUnico: ids[i], numeroPedido: s.numeroPedido, soporteNum: s.soporteNum, soporteTotal: s.soporteTotal,
      origen: datos.origen, subtipo: subtipo, origenTexto: origenTexto, destino: datos.destino,
      fechaCreacion: fecha, loteId: loteId, creadoPor: creadoPor, estado: 'REGISTRADO',
      bateaId: null, fechaEnvio: null, origenTienda: origenTienda, razonFlujo: razonFlujo,
      expedicion: datos.expedicion || null
    };
  });
```

El `|| null` es deliberado: las altas desde la pantalla normal no traen expedición y deben guardar nulo, no cadena vacía, para que el filtro `expedicion=eq.02828945` nunca las confunda con nada.

- [ ] **Paso 2: Lanzar la suite entera**

```bash
node --test
```

Esperado: todo en verde. Las pruebas de `registrarLote` que ya existen no comparan el objeto completo de la fila, así que este campo nuevo no las rompe.

- [ ] **Paso 3: Comprobar que no se ha roto el alta normal**

Este cambio no se puede verificar del todo sin Supabase. Se comprueba en la Tarea 7, con la app desplegada: registrar un lote desde la pantalla normal y confirmar en Supabase que la fila tiene `expedicion` a nulo.

---

## Tarea 4: Familia de pendientes por origen, y arreglo del filtro de INCPC

Hay aquí un fallo latente que hay que arreglar en la misma tarea. Las tres funciones de INCPC excluyen hoy `origen != MECO`. En cuanto existan etiquetas con origen `VALENCIA`, `TORIJA` o `ANTEQUERA`, **se colarían en la pestaña de Incidencias PedidoCliente**. Por eso la exclusión pasa a ser contra la lista entera de orígenes de arrastre.

**Files:**
- Modificar: `hodos/IntegracionIncpc.gs` (bloque de pestañas, desde el comentario "Pestañas INCPC y Prep. Pedidos" hasta el final del archivo)
- Test: `hodos/test/integracionArrastres.test.js` (nuevo)

- [ ] **Paso 1: Escribir las pruebas que fallan**

Crea `test/integracionArrastres.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Un array/objeto creado DENTRO del .gs cargado por vm.runInContext pertenece al realm
// de ese contexto, no al de este archivo — deepStrictEqual los trata como distintos
// aunque el contenido sea idéntico ("same structure but not reference-equal"). .slice()
// no lo arregla (usa el Array del propio realm). El viaje por JSON sí, porque
// reconstruye los valores con los constructores de ESTE realm.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

// Mismo patrón que test/integracionMeco.test.js: Utilidades.gs de verdad
// (validarTienda, parsearLotePedidos) y el resto como stubs.
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '07/09/2026' },
    supaActualizar_: () => [],
    htmlUnaEtiqueta_: (e) => '<div>' + e.idUnico + '</div>',
    envolverEtiquetasHtml_: (t) => '<html>' + t + '</html>'
  }, mocks);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionIncpc.gs'), 'utf8'), ctx);
  return ctx;
}

test('obtenerEtiquetasPendientesArrastre filtra por el origen pedido', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO' },
      { idUnico: 'B', origen: 'Valencia' },
      { idUnico: 'C', origen: 'Torija' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesArrastre('Valencia');
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].idUnico, 'B');
});

test('obtenerEtiquetasPendientesArrastre acepta el origen en minúsculas y devuelve la grafía canónica', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [{ idUnico: 'B', origen: 'Valencia' }]
  });
  assert.strictEqual(ctx.obtenerEtiquetasPendientesArrastre('valencia').length, 1);
  assert.strictEqual(ctx.obtenerEtiquetasPendientesArrastre('VALENCIA').length, 1);
});

test('un origen desconocido es un error, no una consulta abierta', () => {
  const ctx = cargarConMocks({ buscarEtiquetas: () => [] });
  assert.throws(
    () => ctx.obtenerEtiquetasPendientesArrastre('SEVILLA'),
    /Origen de arrastre no reconocido/
  );
});

test('obtenerEtiquetasPendientesMeco sigue existiendo y devuelve solo MECO', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO' },
      { idUnico: 'B', origen: 'Valencia' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesMeco();
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].idUnico, 'A');
});

test('la pestaña de Incidencias excluye TODAS las plataformas de arrastre, no solo Meco (bug real: Valencia/Torija/Antequera ya tienen 738/341/565 etiquetas en producción, en formato título)', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO', subtipo: '' },
      { idUnico: 'B', origen: 'Valencia', subtipo: '' },
      { idUnico: 'C', origen: 'Torija', subtipo: '' },
      { idUnico: 'D', origen: 'Antequera', subtipo: '' },
      { idUnico: 'E', origen: 'Taisa', subtipo: 'Rotura' },
      { idUnico: 'F', origen: 'Taisa', subtipo: 'Petición Reserva' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesIncpc();
  assert.deepStrictEqual(filas.map(function (f) { return f.idUnico; }), ['E']);
});

test('marcarImpresasArrastre filtra por origen en el propio PostgREST, con la grafía canónica', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaActualizar_: (tabla, filtro, cambios) => { llamadas.push({ tabla, filtro, cambios }); return [{}, {}]; }
  });
  const r = ctx.marcarImpresasArrastre('Torija');
  assert.strictEqual(r.cantidad, 2);
  assert.strictEqual(llamadas[0].tabla, 'etiquetas');
  assert.match(llamadas[0].filtro, /origen=eq\.Torija/);
  assert.deepStrictEqual(aRealmLocal(llamadas[0].cambios), { pendiente_impresion_incpc: false });
});

test('marcarImpresasIncpc excluye las cuatro plataformas de arrastre, con sus grafías reales', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaActualizar_: (tabla, filtro, cambios) => { llamadas.push(filtro); return []; }
  });
  ctx.marcarImpresasIncpc();
  assert.match(llamadas[0], /origen=not\.in\.\(MECO,Valencia,Torija,Antequera\)/);
});

test('htmlPendientesArrastre avisa con el nombre de la plataforma si no hay nada', () => {
  const ctx = cargarConMocks({ leerEtiquetas_: () => [] });
  assert.throws(
    () => ctx.htmlPendientesArrastre('Antequera'),
    /No hay etiquetas de Antequera pendientes/
  );
});
```

- [ ] **Paso 2: Lanzar las pruebas y ver que fallan**

```bash
node --test test/integracionArrastres.test.js
```

Esperado: FALLO. Las primeras por `obtenerEtiquetasPendientesArrastre is not a function`; la de "excluye TODAS las plataformas" porque hoy devuelve `['B','C','D','E']` en vez de `['E']`.

- [ ] **Paso 3: Añadir la lista de orígenes y su validación**

En `IntegracionIncpc.gs`, justo encima del comentario `// ── Pestañas "INCPC" y "Prep. Pedidos" en Index.html:`:

```javascript
// Plataformas de arrastre. Cada una tiene su propia pestaña en Index.html, bajo el
// rótulo ARRASTRES, y su propio valor en la columna `origen` de Supabase.
//
// OJO CON LAS MAYÚSCULAS — comprobado contra los datos reales antes de escribir esto
// (2026-09-07): "Cargar lote" ya deja crear Valencia/Torija/Antequera a mano desde
// hace semanas (738/341/565 etiquetas ya existentes), y las tres usan mayúscula solo
// en la inicial, exactamente como en <option value="Valencia">Valencia</option> del
// propio Index.html (línea 330 y siguientes). Solo MECO va en mayúsculas — así lo
// hardcodeaba crearLoteMecoDesdeMacroArrastres_ desde el principio, independiente de
// lo que mande MacroArrastres. Esta lista usa las cuatro grafías EXACTAS que ya hay en
// producción; escribir 'VALENCIA' aquí habría dejado sin pestaña a las etiquetas de
// Valencia/Torija/Antequera que ya existen.
var ORIGENES_ARRASTRE_ = ['MECO', 'Valencia', 'Torija', 'Antequera'];

// Un origen que no esté en la lista es un error, no una consulta sin filtro: si se
// dejara pasar, marcarImpresasArrastre marcaría como impresas etiquetas que no son.
// Comparación insensible a mayúsculas en la ENTRADA (para que MacroArrastres no tenga
// que acertar la grafía exacta), pero SIEMPRE devuelve la grafía canónica de la lista,
// que es la que hay que guardar y comparar en Supabase.
function _validarOrigenArrastre_(origen) {
  var limpio = String(origen || '').trim();
  for (var i = 0; i < ORIGENES_ARRASTRE_.length; i++) {
    if (ORIGENES_ARRASTRE_[i].toLowerCase() === limpio.toLowerCase()) return ORIGENES_ARRASTRE_[i];
  }
  throw new Error('Origen de arrastre no reconocido: "' + origen + '"');
}
```

- [ ] **Paso 4: Arreglar el filtro de las tres funciones de INCPC**

Sustituye las tres funciones de INCPC por estas versiones. El cambio es que la exclusión ya no es solo de MECO:

```javascript
function obtenerEtiquetasPendientesIncpc() {
  // Reutiliza buscarEtiquetas (mismo shape completo que usa el Buscador Interno:
  // soporteNum/soporteTotal/estado/bateaId/etc.) para que la pestaña de Incidencias
  // pueda editar/borrar/reimprimir con exactamente el mismo mecanismo, sin duplicarlo.
  // ordenAscendente:true = más antigua primero (FIFO).
  // Excluye Peticiones de Reserva (mismo origen Taisa, subtipo fijo) Y las cuatro
  // plataformas de arrastre (sin subtipo -> pasarían el filtro de subtipo sin este 2º
  // exclude). Antes solo se excluía MECO, que era la única que existía.
  return buscarEtiquetas({ pendienteImpresionIncpc: true, ordenAscendente: true })
    .filter(function (f) {
      return f.subtipo !== SUBTIPO_PREPARACION_PEDIDOS_ && ORIGENES_ARRASTRE_.indexOf(f.origen) === -1;
    });
}

function _filtroNoArrastre_() {
  return 'origen=not.in.(' + ORIGENES_ARRASTRE_.join(',') + ')';
}

function htmlPendientesIncpc() {
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&subtipo=neq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) + '&' + _filtroNoArrastre_() + '&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de Incidencias PedidoCliente pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasIncpc() {
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&subtipo=neq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) + '&' + _filtroNoArrastre_(), { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}
```

- [ ] **Paso 5: Sustituir el trío de Meco por la familia de arrastres**

Sustituye el bloque final del archivo (desde el comentario `// ── Pestaña "Meco" en Index.html:` hasta el final) por:

```javascript
// ── Pestañas de ARRASTRES en Index.html (Meco, Valencia, Torija, Antequera):
// mismo patrón que Incidencias/Peticiones de Reserva, pero filtrando por origen
// (los arrastres no llevan subtipo, ver crearLoteArrastreDesdeMacroArrastres_). ──

function obtenerEtiquetasPendientesArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  return buscarEtiquetas({ pendienteImpresionIncpc: true, ordenAscendente: true })
    .filter(function (f) { return f.origen === o; });
}

function htmlPendientesArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&origen=eq.' + encodeURIComponent(o) + '&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de ' + o + ' pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&origen=eq.' + encodeURIComponent(o), { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}

// Alias históricos de Meco: los mantiene vivos porque Index.html y cualquier
// despliegue anterior pueden seguir llamándolos.
function obtenerEtiquetasPendientesMeco() { return obtenerEtiquetasPendientesArrastre('MECO'); }
function htmlPendientesMeco() { return htmlPendientesArrastre('MECO'); }
function marcarImpresasMeco() { return marcarImpresasArrastre('MECO'); }
```

- [ ] **Paso 6: Lanzar las pruebas y ver que pasan**

```bash
node --test test/integracionArrastres.test.js
```

Esperado: las ocho pruebas en verde.

- [ ] **Paso 7: Lanzar la suite entera**

```bash
node --test
```

Esperado: todo en verde, incluido `test/integracionMeco.test.js`, que sigue probando los alias.

---

## Tarea 5: Webhook `registrarLoteArrastre` con antiduplicado por expedición

**Files:**
- Modificar: `hodos/IntegracionIncpc.gs` (`doPost` y el bloque de Meco)
- Test: `hodos/test/integracionArrastres.test.js`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade al final de `test/integracionArrastres.test.js`:

```javascript
test('crearLoteArrastre: pasa origen y expedicion a registrarLote y marca el lote pendiente', () => {
  const llamadas = [];
  const supa = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1', 'HODOS-2'], loteId: 'LOTE-1' }; },
    leerEtiquetas_: () => [],
    supaActualizar_: (tabla, filtro, cambios) => { supa.push({ tabla, filtro, cambios }); return []; }
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Marbella', pedidosTexto: '111\n222',
    expedicion: '02828945', operario: 'pedro@x.com'
  });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].origen, 'Valencia');
  assert.strictEqual(llamadas[0].expedicion, '02828945');
  assert.strictEqual(llamadas[0].subtipo, undefined);
  assert.strictEqual(llamadas[0].creadoPor, 'MacroArrastres (Valencia) · pedro@x.com');
  assert.deepStrictEqual(r.idsCreados.slice(), ['HODOS-1', 'HODOS-2']);
  assert.match(supa[0].filtro, /lote_id=eq\.LOTE-1/);
  assert.deepStrictEqual(aRealmLocal(supa[0].cambios), { pendiente_impresion_incpc: true });
});

test('crearLoteArrastre: omite los pedidos que ya existen en esa misma expedicion', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-2' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Torija', destino: 'Mijas', pedidosTexto: '111\n222', expedicion: 'EXP-1'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '222');
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: el MISMO pedido en OTRA expedicion sí crea etiqueta', () => {
  const filtros = [];
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-3' }; },
    // Simula la tabla: solo devuelve el 111 cuando se pregunta por EXP-1.
    leerEtiquetas_: (filtro) => {
      filtros.push(filtro);
      return filtro.indexOf('expedicion=eq.EXP-1') !== -1 ? [{ numeroPedido: '111' }] : [];
    }
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Torija', destino: 'Mijas', pedidosTexto: '111', expedicion: 'EXP-2'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '111');
  assert.strictEqual(r.omitidos.length, 0);
});

test('crearLoteArrastre: sin expedicion NO deduplica, inserta', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-4' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Málaga', pedidosTexto: '111'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '111');
  assert.strictEqual(r.omitidos.length, 0);
});

test('crearLoteArrastre: si todo estaba ya creado, no llama a registrarLote', () => {
  let llamado = false;
  const ctx = cargarConMocks({
    registrarLote: () => { llamado = true; return { ids: [], loteId: 'X' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Málaga', pedidosTexto: '111', expedicion: 'EXP-1'
  });
  assert.strictEqual(llamado, false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idsCreados.length, 0);
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: tienda no reconocida es un error', () => {
  const ctx = cargarConMocks({ registrarLote: () => ({ ids: [], loteId: 'X' }), leerEtiquetas_: () => [] });
  assert.throws(
    () => ctx.crearLoteArrastreDesdeMacroArrastres_({ origen: 'Valencia', destino: 'Sevilla', pedidosTexto: '111' }),
    /Tienda destino no reconocida/
  );
});

test('el alias registrarLoteMeco sigue creando con origen MECO', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1'], loteId: 'LOTE-5' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111', expedicion: 'EXP-9' });
  assert.strictEqual(llamadas[0].origen, 'MECO');
  assert.strictEqual(llamadas[0].creadoPor, 'MacroArrastres (Meco) · desconocido');
});

test('doPost enruta registrarLoteArrastre', () => {
  const ctx = cargarConMocks({
    registrarLote: () => ({ ids: ['HODOS-1'], loteId: 'LOTE-6' }),
    leerEtiquetas_: () => []
  });
  const salida = ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'token-real', accion: 'registrarLoteArrastre',
    origen: 'Antequera', destino: 'Mijas', pedidosTexto: '111', expedicion: 'EXP-3'
  }) } });
  assert.deepStrictEqual(JSON.parse(salida.getContent()).idsCreados, ['HODOS-1']);
});
```

- [ ] **Paso 2: Lanzar las pruebas y ver que fallan**

```bash
node --test test/integracionArrastres.test.js
```

Esperado: FALLO con `crearLoteArrastreDesdeMacroArrastres_ is not a function`.

- [ ] **Paso 3: Escribir la función nueva**

En `IntegracionIncpc.gs`, sustituye `crearLoteMecoDesdeMacroArrastres_` y `_loteMecoReciente_` por:

```javascript
// Integración con MacroArrastres: un lote de pedidos por tienda y plataforma, sin
// subtipo (el subtipo solo tiene sentido para origen Taisa, ver subtipoEfectivo en
// Utilidades.gs). Ver
// MacroArrastres/docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md.
function crearLoteArrastreDesdeMacroArrastres_(datos) {
  var origen = _validarOrigenArrastre_(datos.origen);
  var destino = validarTienda(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  var pedidosTexto = String(datos.pedidosTexto || '').trim();
  if (!pedidosTexto) throw new Error('Falta la lista de pedidos');

  var expedicion = String(datos.expedicion || '').trim();
  var nombreBonito = origen.charAt(0) + origen.slice(1).toLowerCase();
  var creadoPor = 'MacroArrastres (' + nombreBonito + ') · ' + (datos.operario || 'desconocido');

  // Antiduplicado por EXPEDICIÓN, no por fecha: un mismo pedido puede llegar varias
  // veces el mismo día, pero cada llegada es una expedición distinta y necesita su
  // etiqueta (dato de Pedro, 2026-09-07). Sin expedición no se deduplica: mejor una
  // etiqueta de más, que se ve y se tira, que una de menos, que no se ve.
  var lineas = parsearLotePedidos(pedidosTexto);
  var omitidos = [];
  if (expedicion) {
    var yaCreados = _pedidosYaCreadosEnExpedicion_(origen, destino, expedicion);
    var nuevas = [];
    lineas.forEach(function (l) {
      if (yaCreados[l]) omitidos.push(l); else nuevas.push(l);
    });
    lineas = nuevas;
  }
  if (lineas.length === 0) {
    return { ok: true, idsCreados: [], omitidos: omitidos };
  }

  var resultado = registrarLote({
    origen: origen, destino: destino, pedidosTexto: lineas.join('\n'),
    creadoPor: creadoPor, expedicion: expedicion
  });

  // Marca TODO el lote de una vez (por loteId) como pendiente de imprimir, para que
  // salga en la pestaña de su plataforma. Misma bandera que Incidencias/Peticiones de
  // Reserva; lo que cambia es el filtro de cada pestaña.
  supaActualizar_('etiquetas', 'lote_id=eq.' + encodeURIComponent(resultado.loteId), { pendiente_impresion_incpc: true });

  return { ok: true, idsCreados: resultado.ids, omitidos: omitidos };
}

// Devuelve { '99143242': true, ... } con los pedidos que ya tienen etiqueta de esa
// plataforma, tienda y expedición. El texto del pedido se compara entero: "99143242" y
// "99143242+99143337" son etiquetas físicas distintas y deben tratarse como distintas.
function _pedidosYaCreadosEnExpedicion_(origen, destino, expedicion) {
  var filtro = 'origen=eq.' + encodeURIComponent(origen)
    + '&destino=eq.' + encodeURIComponent(destino)
    + '&expedicion=eq.' + encodeURIComponent(expedicion);
  var mapa = {};
  leerEtiquetas_(filtro).forEach(function (f) { mapa[f.numeroPedido] = true; });
  return mapa;
}

// Alias histórico: MacroArrastres todavía puede estar desplegado llamando a
// 'registrarLoteMeco' sin mandar expedición. En ese caso se conserva la vieja ventana
// de 3 minutos como red; en cuanto llega expedición, manda el criterio bueno.
function crearLoteMecoDesdeMacroArrastres_(datos) {
  datos = datos || {};
  if (!String(datos.expedicion || '').trim()) {
    var destinoLegacy = validarTienda(datos.destino);
    if (destinoLegacy && _loteMecoReciente_(destinoLegacy)) {
      return { ok: true, idsCreados: [], duplicado: true, motivo: 'Ya se procesó un ZIP de Meco para ' + destinoLegacy + ' hace menos de 3 min.' };
    }
  }
  var copia = {};
  Object.keys(datos).forEach(function (k) { copia[k] = datos[k]; });
  copia.origen = 'MECO';
  return crearLoteArrastreDesdeMacroArrastres_(copia);
}

function _loteMecoReciente_(destino) {
  var desdeIso = new Date(Date.now() - UMBRAL_DUPLICADO_INCPC_MS_).toISOString();
  var filtro = 'origen=eq.MECO&destino=eq.' + encodeURIComponent(destino)
    + '&creado_por=like.MacroArrastres*'
    + '&fecha_creacion=gte.' + encodeURIComponent(desdeIso) + '&limit=1';
  return leerEtiquetas_(filtro).length > 0;
}
```

- [ ] **Paso 4: Enrutar la acción nueva en `doPost`**

En `doPost`, sustituye la cadena de `else if`:

```javascript
    } else if (datos.accion === 'registrarLoteArrastre') {
      respuesta = crearLoteArrastreDesdeMacroArrastres_(datos);
    } else if (datos.accion === 'registrarLoteMeco') {
      respuesta = crearLoteMecoDesdeMacroArrastres_(datos);
    } else {
```

- [ ] **Paso 5: Lanzar las pruebas y ver que pasan**

```bash
node --test test/integracionArrastres.test.js
```

Esperado: las dieciséis pruebas del archivo en verde.

- [ ] **Paso 6: Lanzar la suite entera**

```bash
node --test
```

`test/integracionMeco.test.js` (el archivo viejo, específico de Meco) tiene dos pruebas que este cambio deja
desactualizadas — no por un fallo, sino porque el contrato de la función mejoró de verdad:

1. La prueba de la línea 26 compara `JSON.stringify(resultado)` contra
   `{ ok: true, idsCreados: [...] }`. `crearLoteArrastreDesdeMacroArrastres_` ahora devuelve siempre
   `omitidos` también (vacío si no hay expedición). Arréglala así:

   ```javascript
   assert.strictEqual(JSON.stringify(resultado), JSON.stringify({ ok: true, idsCreados: ['HODOS-1', 'HODOS-2'], omitidos: [] }));
   ```

2. La prueba `htmlPendientesMeco: filtro correcto y error claro si no hay ninguna` (línea ~129) espera el
   texto `/No hay etiquetas de Meco pendientes/`. La grafía canónica real de MECO es en mayúsculas
   (`ORIGENES_ARRASTRE_`), así que el mensaje ahora dice "MECO", no "Meco". Arréglala así:

   ```javascript
   assert.throws(() => sb.htmlPendientesMeco(), /No hay etiquetas de MECO pendientes/);
   ```

Esperado tras los dos arreglos: todo en verde (177 pruebas en total en este punto del plan).

---

## Tarea 6: Interfaz — renombres y bloque ARRASTRES

Esta tarea no tiene pruebas automáticas: es HTML y JavaScript de navegador, y este proyecto no tiene banco de pruebas de interfaz. Se verifica a mano en la Tarea 7.

**Files:**
- Modificar: `hodos/Index.html`

- [ ] **Paso 1: Renombrar las dos pestañas existentes**

En `Index.html:299-306`, cambia **solo el texto visible**. El `data-tab` y el `onclick` no se tocan:

```html
    <button data-tab="incpc" onclick="cambiarPestana('incpc')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <span>Incidencias PedidoCliente</span>
    </button>
    <button data-tab="preparacion" onclick="cambiarPestana('preparacion')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <span>Peticiones de Reserva</span>
    </button>
```

- [ ] **Paso 2: Añadir el CSS del rótulo y las pestañas indentadas**

En `Index.html`, justo después de la regla `.app-sidebar button.active` (línea 74):

```css
    .sidebar-rotulo {
      margin:14px 0 2px; padding:0 14px; font-size:11px; font-weight:700;
      letter-spacing:0.08em; text-transform:uppercase; opacity:0.5;
      color:var(--text-primary);
    }
    .app-sidebar button.sub { padding-left:30px; font-size:13.5px; }
```

Y dentro del bloque `@media (max-width:860px)`, después de `.app-sidebar button { ... }` (línea 84), para que en móvil el rótulo no ocupe una fila entera:

```css
      .sidebar-rotulo { display:none; }
      .app-sidebar button.sub { padding-left:6px; }
```

- [ ] **Paso 3: Sustituir el botón de Meco por el bloque de las cuatro plataformas**

Sustituye el botón de Meco (`Index.html:307-310`) por:

```html
    <div class="sidebar-rotulo">Arrastres</div>
    <button class="sub" data-tab="meco" onclick="cambiarPestana('meco')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <span>Meco</span>
    </button>
    <button class="sub" data-tab="valencia" onclick="cambiarPestana('valencia')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <span>Valencia</span>
    </button>
    <button class="sub" data-tab="torija" onclick="cambiarPestana('torija')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <span>Torija</span>
    </button>
    <button class="sub" data-tab="antequera" onclick="cambiarPestana('antequera')">
      <svg class="icon" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      <span>Antequera</span>
    </button>
```

- [ ] **Paso 4: Sustituir la vista de Meco por las cuatro vistas**

Sustituye el bloque `<!-- ══════════ VISTA: MECO ... -->` completo (`Index.html:504-520`, hasta el `</div>` que cierra `vistaMeco`) por:

```html
    <!-- ══════════ VISTAS: ARRASTRES (Meco, Valencia, Torija, Antequera) ══════════
         Etiquetas creadas por MacroArrastres. Las cuatro son idénticas salvo el
         identificador: el JS las maneja con una sola función parametrizada
         (ver ARRASTRES_ más abajo). -->
    <div id="vistaMeco" class="vista-oculta">
      <div class="busqueda-form">
        <span id="contadorMeco" class="hint-texto">Cargando…</span>
        <button type="button" class="btn-imprimir" id="btnImprimirMeco" onclick="imprimirTodasArrastre_('meco')" disabled>
          Imprimir todas
        </button>
        <button type="button" class="btn-secundario" onclick="agruparSeleccionadosUI_()" style="margin-left:8px;">
          Agrupar seleccionados
        </button>
        <button type="button" class="btn-secundario" onclick="borrarSeleccionadosUI_()" style="margin-left:8px;">
          Borrar seleccionados
        </button>
        <button type="button" class="btn-link" onclick="cargarArrastre_('meco')" title="Actualizar">Actualizar</button>
      </div>
      <div class="resultados-wrap"><div id="resultadosMeco"></div></div>
    </div>

    <div id="vistaValencia" class="vista-oculta">
      <div class="busqueda-form">
        <span id="contadorValencia" class="hint-texto">Cargando…</span>
        <button type="button" class="btn-imprimir" id="btnImprimirValencia" onclick="imprimirTodasArrastre_('valencia')" disabled>
          Imprimir todas
        </button>
        <button type="button" class="btn-secundario" onclick="agruparSeleccionadosUI_()" style="margin-left:8px;">
          Agrupar seleccionados
        </button>
        <button type="button" class="btn-secundario" onclick="borrarSeleccionadosUI_()" style="margin-left:8px;">
          Borrar seleccionados
        </button>
        <button type="button" class="btn-link" onclick="cargarArrastre_('valencia')" title="Actualizar">Actualizar</button>
      </div>
      <div class="resultados-wrap"><div id="resultadosValencia"></div></div>
    </div>

    <div id="vistaTorija" class="vista-oculta">
      <div class="busqueda-form">
        <span id="contadorTorija" class="hint-texto">Cargando…</span>
        <button type="button" class="btn-imprimir" id="btnImprimirTorija" onclick="imprimirTodasArrastre_('torija')" disabled>
          Imprimir todas
        </button>
        <button type="button" class="btn-secundario" onclick="agruparSeleccionadosUI_()" style="margin-left:8px;">
          Agrupar seleccionados
        </button>
        <button type="button" class="btn-secundario" onclick="borrarSeleccionadosUI_()" style="margin-left:8px;">
          Borrar seleccionados
        </button>
        <button type="button" class="btn-link" onclick="cargarArrastre_('torija')" title="Actualizar">Actualizar</button>
      </div>
      <div class="resultados-wrap"><div id="resultadosTorija"></div></div>
    </div>

    <div id="vistaAntequera" class="vista-oculta">
      <div class="busqueda-form">
        <span id="contadorAntequera" class="hint-texto">Cargando…</span>
        <button type="button" class="btn-imprimir" id="btnImprimirAntequera" onclick="imprimirTodasArrastre_('antequera')" disabled>
          Imprimir todas
        </button>
        <button type="button" class="btn-secundario" onclick="agruparSeleccionadosUI_()" style="margin-left:8px;">
          Agrupar seleccionados
        </button>
        <button type="button" class="btn-secundario" onclick="borrarSeleccionadosUI_()" style="margin-left:8px;">
          Borrar seleccionados
        </button>
        <button type="button" class="btn-link" onclick="cargarArrastre_('antequera')" title="Actualizar">Actualizar</button>
      </div>
      <div class="resultados-wrap"><div id="resultadosAntequera"></div></div>
    </div>
```

- [ ] **Paso 5: Sustituir `cargarMeco_` e `imprimirTodasMeco_` por las versiones parametrizadas**

Sustituye las dos funciones (`Index.html:1032-1055`, `cargarMeco_` e `imprimirTodasMeco_`) por:

```javascript
  // Las cuatro pestañas de arrastres comparten toda la lógica: solo cambian el
  // identificador del DOM y el valor de `origen` que espera el backend.
  // Los valores de "origen" son EXACTOS a como ya están en Supabase (comprobado
  // contra los datos reales, 2026-09-07): "MECO" en mayúsculas, las otras tres solo
  // con la inicial en mayúscula, igual que <option value="Valencia"> en el desplegable
  // de "Cargar lote" (arriba en este mismo archivo).
  var ARRASTRES_ = {
    meco:      { origen: 'MECO',      titulo: 'Meco',      sufijo: 'Meco' },
    valencia:  { origen: 'Valencia',  titulo: 'Valencia',  sufijo: 'Valencia' },
    torija:    { origen: 'Torija',    titulo: 'Torija',    sufijo: 'Torija' },
    antequera: { origen: 'Antequera', titulo: 'Antequera', sufijo: 'Antequera' }
  };

  function cargarArrastre_(tab) {
    var cfg = ARRASTRES_[tab];
    document.getElementById('resultados' + cfg.sufijo).innerHTML = '<p class="cargando-resultados">Cargando…</p>';
    gas('obtenerEtiquetasPendientesArrastre', cfg.origen).then(function (filas) {
      document.getElementById('btnImprimir' + cfg.sufijo).disabled = !filas || filas.length === 0;
      document.getElementById('contador' + cfg.sufijo).textContent =
        (filas ? filas.length : 0) + ' etiqueta(s) de ' + cfg.titulo + ' pendiente(s) de imprimir';
      renderizarResultados('resultados' + cfg.sufijo, filas);
    }).catch(function (err) {
      document.getElementById('resultados' + cfg.sufijo).innerHTML =
        '<p class="cargando-resultados">Error: ' + (err && err.message ? err.message : err) + '</p>';
    });
  }

  function imprimirTodasArrastre_(tab) {
    var cfg = ARRASTRES_[tab];
    gas('htmlPendientesArrastre', cfg.origen).then(function (html) {
      imprimirHtmlEtiquetas_(Promise.resolve(html));
      return gas('marcarImpresasArrastre', cfg.origen);
    }).then(function () {
      cargarArrastre_(tab);
    }).catch(function (err) {
      alert('Error al imprimir: ' + (err && err.message ? err.message : err));
    });
  }
```

- [ ] **Paso 6: Actualizar `cambiarPestana`**

Sustituye `cambiarPestana` (`Index.html:1801-1817`) por:

```javascript
  function cambiarPestana(nombre) {
    // "camion" ya no vive en el panel de administración (tiene su propia URL
    // ?vista=operario, sin sidebar).
    document.getElementById('vistaCarga').classList.toggle('vista-oculta', nombre !== 'carga');
    document.getElementById('vistaInterno').classList.toggle('vista-oculta', nombre !== 'interno');
    document.getElementById('vistaPendientes').classList.toggle('vista-oculta', nombre !== 'pendientes');
    document.getElementById('vistaIncpc').classList.toggle('vista-oculta', nombre !== 'incpc');
    document.getElementById('vistaPreparacion').classList.toggle('vista-oculta', nombre !== 'preparacion');
    document.getElementById('vistaMeco').classList.toggle('vista-oculta', nombre !== 'meco');
    document.getElementById('vistaValencia').classList.toggle('vista-oculta', nombre !== 'valencia');
    document.getElementById('vistaTorija').classList.toggle('vista-oculta', nombre !== 'torija');
    document.getElementById('vistaAntequera').classList.toggle('vista-oculta', nombre !== 'antequera');
    document.querySelectorAll('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === nombre); });
    if (nombre === 'interno') { buscarYMostrar('interno'); }
    if (nombre === 'carga') { cargarHistorial(); }
    if (nombre === 'pendientes') { cargarPendientes_(); }
    if (nombre === 'incpc') { cargarIncpc_(); }
    if (nombre === 'preparacion') { cargarPreparacion_(); }
    if (ARRASTRES_[nombre]) { cargarArrastre_(nombre); }
  }
```

- [ ] **Paso 7: Comprobar que no queda ninguna llamada a las funciones viejas**

```bash
grep -n "cargarMeco_\|imprimirTodasMeco_" Index.html
```

Esperado: sin resultados. Si aparece alguno, es una llamada huérfana que hay que cambiar a la versión parametrizada.

- [ ] **Paso 8: Comprobar el desplegable de origen del Buscador Interno (no hace falta tocarlo)**

Antes de escribir este plan se asumía que había que añadir Valencia/Torija/Antequera al `select` con id `internoOrigen`. Al comprobar el archivo real, esas tres opciones **ya existen** (`Index.html:419-424`), porque "Cargar lote" ya permite crear estas plataformas a mano desde hace semanas. Confirma que siguen ahí y no falta ninguna:

```bash
grep -n 'option value="Valencia"\|option value="Torija"\|option value="Antequera"\|option value="MECO"' Index.html
```

Esperado: 8 líneas (cada opción aparece dos veces: en el `select#origen` de "Cargar lote" y en el `select#internoOrigen` del Buscador). Si falta alguna, es que el archivo ha cambiado desde que se escribió este plan — añádela con el mismo `value` que usan las demás (título con mayúscula inicial, salvo MECO).

---

## Tarea 7: Desplegar y verificar en real

**Files:**
- Ninguno (despliegue)

- [ ] **Paso 1: Traer lo que haya en el editor antes de subir**

Alguien puede haber tocado el proyecto desde el navegador. Desde `C:\Users\30081048\Desktop\Proyectos\hodos`:

```bash
clasp pull
```

No hay git con el que comparar, así que compruébalo a mano. Los cuatro archivos que has tocado tienen que seguir conteniendo tus cambios:

```bash
grep -c "ORIGENES_ARRASTRE_" IntegracionIncpc.gs
grep -c "expedicion" EstructuraSheets.gs
grep -c "datos.expedicion" Backend.gs
grep -c "sidebar-rotulo" Index.html
```

Esperado: los cuatro devuelven un número mayor que 0. Si alguno devuelve 0, `clasp pull` ha sobrescrito tu trabajo con la versión del editor: vuelve a aplicar los cambios de esa tarea antes de continuar. **No subas sin haber tirado antes** — ya pasó una vez en este proyecto que un `push` sin `pull` previo borró configuración que el usuario había escrito en el navegador.

- [ ] **Paso 2: Borrar los `.js` duplicados que crea `clasp pull`**

`clasp pull` baja los archivos como `.js` además de los `.gs` que ya existen, y el push siguiente falla con "A file with this name already exists":

```bash
rm -f *.js
```

- [ ] **Paso 3: Lanzar la suite completa por última vez**

```bash
node --test
```

Esperado: todo en verde. Si algo falla, no subas.

- [ ] **Paso 4: Subir**

```bash
clasp push -f
```

Esperado: `Pushed N files.`

- [ ] **Paso 5: Desplegar sobre el mismo despliegue de siempre**

La URL de la app tiene que seguir siendo la misma: MacroArrastres la tiene guardada en `MecoConfig.gs`. Consulta el identificador del despliegue en uso y actualízalo:

```bash
clasp deployments
```

Toma el identificador del despliegue de producción y ejecuta:

```bash
clasp deploy --deploymentId <ID> --description "Pestañas de arrastres + registrarLoteArrastre"
```

Nota: en este proyecto `clasp deployments` ya ha fallado antes en listar el despliegue que está realmente en uso. Si la lista sale vacía o no incluye el de producción, **no crees un despliegue nuevo**: eso generaría otra URL y MacroArrastres seguiría llamando a la vieja. Saca el identificador correcto de la URL que hay guardada en `MacroArrastes/MecoConfig.gs` (`MECO_HODOS_WEBAPP_URL`), que es la que está en producción, o pregunta al usuario antes de seguir.

- [ ] **Paso 6: Verificar la interfaz**

Abre la app y comprueba:
- La barra lateral muestra `Cargar lote`, `Buscar`, `Pendientes`, `Incidencias PedidoCliente`, `Peticiones de Reserva`, el rótulo `ARRASTRES`, y debajo indentadas `Meco`, `Valencia`, `Torija`, `Antequera`.
- Cada una de las cuatro abre su vista y dice "0 etiqueta(s) de X pendiente(s)" (o las que haya de Meco).
- La pestaña `Incidencias PedidoCliente` sigue mostrando lo mismo que antes del cambio.
- El desplegable de origen del Buscador Interno lista las cuatro plataformas.

- [ ] **Paso 7: Verificar el alta con una etiqueta de prueba**

Desde la pantalla `Cargar lote`, registra un lote con origen `Valencia`, destino `Mijas` y un pedido inventado como `TEST-PLAN1`.

Nota: este lote **no** aparecerá en la pestaña "Valencia" nueva, y es lo correcto — "Cargar lote" no marca `pendiente_impresion_incpc`, así que las etiquetas creadas a mano (como las 738/565/341 que ya existían) nunca han pasado por esa bandera. La pestaña Valencia solo mostrará lo que llegue por el webhook `registrarLoteArrastre`, que es el que usará MacroArrastres desde el Plan 2. Aquí solo se comprueba que Buscar sigue encontrando el pedido de prueba, que es lo que sí toca "Cargar lote". Luego, en Supabase:

```sql
select id_unico, origen, destino, numero_pedido, expedicion
from public.etiquetas
where numero_pedido = 'TEST-PLAN1';
```

Esperado: una fila con `expedicion` a nulo. Eso confirma que el alta normal sigue funcionando y no escribe basura en la columna nueva.

- [ ] **Paso 8: Borrar la etiqueta de prueba**

Búscala en el Buscador Interno por `TEST-PLAN1` y bórrala desde la app.

---

## Qué queda para los planes siguientes

- **Plan 2 — MacroArrastres, automatización:** origen y expedición por línea en `_generarHodos_`, envío automático al terminar `procesarArrastres`, impresión automática con carátula, cajón del CSV de Valencia/Torija y cajón del XLSX de Recepción.
- **Plan 3 — Panel Arrastres:** separación de núcleo e interfaz en los procesos, `doGet`, `Web.html`, candado con `LockService` y despliegue de la web app.
