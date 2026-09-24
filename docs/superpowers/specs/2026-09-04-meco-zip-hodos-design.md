# Meco: ZIP automático → impresión CCM + etiquetas HODOS

## Contexto

Hoy, cada envío de Meco llega como un ZIP (ej. `R-4416-BCW.zip`) con dos partes:

- **`CCM/`**: una subcarpeta por tienda (`E014`, `E036`, `E043`, `E279`) con un `Albaran-*.csv` cada una — pedidos que **se quedan en la plataforma** (flujo CCM, ya llevan gastos de envío). Pedro los pega hoy en TOP y pulsa "Meco — aplicar formato" para cada tienda, tienda a tienda.
- **`PLAT MALAGA/`**: una subcarpeta por tienda (`E014`, `E036`, `E279` — sin `E043`) más un Excel suelto `R-<código>.xlsx` con columnas `Cod. Tienda | Nom.Tienda | Expedición | CMP | Peso`. Esas filas son pedidos que **van a tienda sin quedar trazados** — hoy Pedro los da de alta a mano en la app **HODOS** (proyecto aparte, `C:\Users\30081048\Desktop\Proyectos\hodos`, un webapp con Supabase), seleccionando origen `MECO`, la tienda, y pegando la lista de CMP como lote.

Este documento cubre automatizar las dos partes soltando el ZIP una sola vez en MacroArrastres.

**Solo tres tiendas están operativas para Taisa**: E036=Málaga, E014=Marbella, E279=Mijas. `E043` aparece en `CCM/` pero no se opera — confirmado con Pedro: sus pedidos **si** se imprimen/retienen en plataforma (como cualquier otra), simplemente no generan nada en HODOS (ahí no aparece de todos modos, `PLAT MALAGA/` no trae carpeta E043).

## Alcance — dos proyectos, dos fases

| | Proyecto | Qué hace | Bloqueante para lo otro |
|---|---|---|---|
| **Fase 1A** | MacroArrastres | ZIP → imprime CCM por tienda (páginas separadas) | No |
| **Fase 1B** | MacroArrastres + **hodos** | ZIP → crea etiquetas HODOS (origen MECO) desde PLAT MALAGA | Sí, necesita cambio en `hodos` |
| **Fase 2** (más adelante) | hodos | Pestaña "Meco" dedicada de pendientes/imprimir en `Index.html`, igual que ya tienen INCPC y Preparación de Pedidos | No — las etiquetas ya son correctas y visibles (Buscador Interno, pantallas de carga) sin esto |

Fase 1B necesita tocar `hodos` porque el webhook actual (`doPost` en `IntegracionIncpc.gs`) fuerza `origen:'Taisa'` con un pedido por llamada; MECO no lleva subtipo y hoy se da de alta **por lote** (varios CMP de una vez, como ya hace `registrarLote` internamente). Sin este cambio, las etiquetas de Meco se crearían mal etiquetadas como Taisa.

---

## Fase 1A: CCM → impresión por tienda

### Entrada del ZIP

- Botón nuevo en el panel: **"📦 Procesar ZIP Meco"**.
- Abre un diálogo (`MecoZipForm.html`, mismo patrón que `AntequeraForm.html`) con `<input type="file" accept=".zip">`.
- Cliente lee el archivo como base64 (`FileReader`) y llama a `google.script.run.procesarZipMeco(base64, nombreArchivo)`.
- Servidor: `Utilities.newBlob(...)` → `Utilities.unzip(blob)` → array de blobs, cada uno con `getName()` = ruta dentro del ZIP (ej. `R-4416-BCW/CCM/03-09-2026 05246897 E036          -x/Albaran-448-05246897.csv`).

### Localizar los archivos que importan

De todos los blobs del ZIP, solo se usan:
- Los que su ruta contiene `/CCM/` **y** el nombre de archivo empieza por `Albaran-` (uno por carpeta de tienda: E014/E036/E043/E279). El código de tienda se saca del nombre de la carpeta (contiene "E014"/"E036"/etc.).
- El único `.xlsx` que cuelga directamente de `PLAT MALAGA/` (no dentro de una subcarpeta de tienda) — es el `R-<código>.xlsx`.

Todo lo demás (`Bultos1Rec-*.csv`, `ContenidosEntregados-*.csv`, `flag.txt`, el Albaran/Excel de `PLAT MALAGA/*/`, el `.xlsx` de dentro de `CCM/`) se ignora — confirmado con Pedro.

Si falta el Albaran de alguna tienda de CCM, o no aparece el `.xlsx` de PLAT MALAGA: aviso claro (toast) listando qué falta, sin abortar lo que sí se pudo procesar.

### Mapeo Albaran → formato TOP-Meco

El Albaran (`;` como separador) trae:
```
ALMACEN;ID_OPTIMUS;FLETE;FECHA;COD_TIENDA;TIENDA;CIRCUITO;PEDIDO;FLUJO;SECCION;REF_LM;DESIG;EAN;CANTIDAD;DOM;PYXIS;CONTENIDO;CONTE_AGRUP;SOP_ALM1;AGRUP_ALM1;SOP_ALM2;TRANSPORTE
```
Se mapea a las columnas que ya usa `procesarMeco()` (mismos índices 0-based que hoy, ver `Proceso_Meco.gs`):

| Columna TOP | Origen (Albaran) |
|---|---|
| A (Optimus) | ID_OPTIMUS |
| C (Flete) | FLETE |
| F (Tienda) | TIENDA |
| H (Pedido) | PEDIDO |
| K (LM) | REF_LM |
| L (Artículo) | DESIG |
| M (EAN) | EAN |
| N (Cantidad) | CANTIDAD |
| P (Pyxis) | PYXIS |

El resto de columnas del layout TOP-Meco quedan en blanco (no hay dato equivalente en el Albaran y hoy tampoco se usan tras `procesarMeco`).

Se reutiliza el resto de `procesarMeco()` tal cual (orden numérico por Pyxis, color alterno, cabeceras, `_lmNum_`, columnas ocultas) — es la misma lógica, solo cambia de dónde vienen los datos.

### Fecha automática, con el mismo salto de fin de semana de siempre

El Albaran trae `FECHA` (ej. `03/09/2026`). La fecha de llegada = **FECHA + 1 día**, saltando a lunes si cae en fin de semana — la misma regla que ya usa `_fechaEnvioPorOrigen_('Meco')`, pero hoy esa función siempre parte de "hoy" (`new Date()`). Se generaliza:

```javascript
function _fechaEnvioPorOrigen_(tipo, fechaBase) {
  const off = CFG.DIA_POR_ORIGEN.hasOwnProperty(t_(tipo)) ? CFG.DIA_POR_ORIGEN[t_(tipo)] : 0;
  const d = fechaBase ? new Date(fechaBase) : new Date();   // ← único cambio
  d.setDate(d.getDate() + off);
  ...  // resto igual
}
```
Retrocompatible: todas las llamadas existentes (sin segundo argumento) siguen igual. La llamada nueva pasa la `FECHA` del Albaran parseada (`dd/mm/yyyy` → `Date`).

### Impresión con salto de página por tienda

En vez de tabs nuevas: **una sola vista de impresión** que junta las 4 tiendas (E014/E036/E043/E279, en ese orden o el que ya use CFG) con `page-break-before` en CSS antes de cada tienda (excepto la primera) — mismo mecanismo de impresión que `htmlImprimirTOP` (`Impresion.gs`), reutilizando su enfoque de escala/ancho que ya "FUNCIONA" (ver `CLAUDE.md`, no volver a `table-layout:fixed`).

No se toca la hoja TOP real ni se pega nada en ella — todo el procesado ocurre en memoria y se manda directo a la vista de impresión. El botón normal "Meco — aplicar formato" (pegado manual) sigue existiendo igual que hoy, sin cambios, como respaldo.

---

## Fase 1B: PLAT MALAGA → etiquetas HODOS (origen MECO)

Mismo botón y misma llamada `procesarZipMeco()` de la Fase 1A — un solo soltar-ZIP hace las dos cosas: al terminar de montar la vista de impresión de CCM, sigue con esto antes de devolver el resultado al panel.

### Lectura del Excel

`R-<código>.xlsx`: columnas `Cod. Tienda (A) | Nom.Tienda (B) | Expedición (C) | CMP (D) | Peso (E)`. Como es `.xlsx` (no CSV), no se puede leer con `Utilities.parseCsv`: el blob se sube temporalmente a Drive con conversión a Google Sheets (`Drive API` avanzada, ya habilitada — ver `dependencies` en `appsscript.json` si hace falta activarla), se lee con `SpreadsheetApp.openById(...).getSheets()[0].getDataRange().getValues()`, y se **borra el archivo temporal** al terminar (éxito o error, en un `finally`).

Cada fila: `Cod. Tienda` (`E014`/`E036`/`E279`) → tienda canónica (mismo mapeo que ya existe en `CFG.TIENDA_ARRASTRE`: E014→Marbella, E036→Málaga, E279→Mijas). `CMP` (columna D) = el número que hoy Pedro pega en HODOS.

### Payload al webhook — por TIENDA, no por fila

Hoy Pedro da de alta un **lote** en HODOS (origen MECO, una tienda, lista de CMP pegada de una vez) — no uno a uno. Se replica igual: se agrupan las filas del Excel por tienda, y se hace **una llamada al webhook por tienda** (como mucho 3, no ~80+):

```json
{
  "accion": "registrarLoteMeco",
  "token": "...",
  "destino": "Málaga",
  "pedidosTexto": "53354101\n53354016\n...",
  "operario": "pedro.gil@ext.leroymerlin.es"
}
```

### Cambio en `hodos` (`IntegracionIncpc.gs`)

`doPost` pasa a distinguir por `datos.accion` — **sin tocar el comportamiento actual de INCPC/Preparación** (que no mandan `accion`, siguen cayendo en el camino de siempre):

```javascript
function doPost(e) {
  var respuesta;
  try {
    var datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
    if (!tokenEsperado || datos.token !== tokenEsperado) {
      respuesta = { ok: false, error: 'Token inválido' };
    } else if (datos.accion === 'registrarLoteMeco') {
      respuesta = crearLoteMecoDesdeMacroArrastres_(datos);           // ← nuevo
    } else {
      var idUnico = crearEtiquetaDesdeIncpc_(datos);                  // igual que siempre
      respuesta = { ok: true, idUnico: idUnico };
    }
  } catch (err) {
    respuesta = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

function crearLoteMecoDesdeMacroArrastres_(datos) {
  var destino = validarTienda(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  if (!String(datos.pedidosTexto || '').trim()) throw new Error('Falta la lista de pedidos (CMP)');

  var creadoPor = 'MacroArrastres (Meco) · ' + (datos.operario || 'desconocido');

  // Antiduplicado (mismo espíritu que _etiquetaIncpcReciente_ para INCPC): si ya
  // existe una etiqueta MECO para este destino creada por esta integración en los
  // últimos 3 min, no se reprocesa el lote entero — evita duplicar si el ZIP se
  // sube dos veces por error (ej. doble clic, reintento de red).
  var reciente = _loteMecoReciente_(destino);
  if (reciente) return { ok: true, idsCreados: [], duplicado: true, motivo: 'Ya se procesó un ZIP de Meco para ' + destino + ' hace menos de 3 min.' };

  var resultado = registrarLote({ origen: 'MECO', destino: destino, pedidosTexto: datos.pedidosTexto, creadoPor: creadoPor });
  return { ok: true, idsCreados: resultado.ids };
}

function _loteMecoReciente_(destino) {
  var desdeIso = new Date(Date.now() - UMBRAL_DUPLICADO_INCPC_MS_).toISOString();
  var filtro = 'origen=eq.MECO&destino=eq.' + encodeURIComponent(destino)
    + '&creado_por=like.MacroArrastres*'
    + '&fecha_creacion=gte.' + encodeURIComponent(desdeIso) + '&limit=1';
  return leerEtiquetas_(filtro).length > 0;
}
```

*(Nombres/columnas exactos de Supabase a confirmar contra el esquema real de `leerEtiquetas_`/`supaActualizar_` al implementar — el resto de `IntegracionIncpc.gs` ya usa ese mismo patrón de filtro, así que debería encajar directo.)*

### Configuración (una vez, la hace Pedro)

MacroArrastres necesita 2 propiedades de script nuevas (Extensiones → Propiedades del script):
- `INCPC_SHARED_TOKEN` — mismo valor que ya tiene `hodos` (se reutiliza el token compartido existente, no uno nuevo).
- `HODOS_WEBAPP_URL` — la URL `/exec` del despliegue de `hodos`.

Ninguno de los dos lo maneja Claude — los pega Pedro directamente.

### Errores parciales

Si falla la llamada de una tienda (red, token, HODOS caído), se sigue con las demás y al final se informa exactamente cuál falló y por qué — no se aborta el resto ni se reintenta solo.

---

## Fase 2 (resumen, no se detalla aquí)

Pestaña "Meco" en `hodos/Index.html`, mismo patrón que `obtenerEtiquetasPendientesIncpc`/`htmlPendientesIncpc`/`marcarImpresasIncpc`, filtrando por `origen==='MECO'` en vez de por subtipo. Se hace como spec aparte cuando toque, no bloquea la Fase 1.

---

## Testing

Mismo patrón que el resto de MacroArrastres: simulaciones Node (`vm.runInContext`) antes de cualquier `clasp push`, cubriendo:
- Descompresión + localización de archivos dentro del ZIP real (`R-4416-BCW.zip`, ya usado para diseñar esto).
- Mapeo Albaran → TOP-Meco con datos reales de las 4 tiendas.
- Fecha con `FECHA` del Albaran como base, incluidos los casos de salto de fin de semana.
- Agrupación por tienda del Excel de PLAT MALAGA (sin llamar a un `hodos` real — se verifica el payload construido, no la llamada HTTP en sí).
- El lado `hodos` (`crearLoteMecoDesdeMacroArrastres_`) se prueba por separado en su propio proyecto, con su propio `node --test` (ya tiene suite).

## Decisiones ya tomadas con Pedro (no reabrir sin motivo)

- E043 se imprime en CCM, no aparece en HODOS.
- "Separado por tienda" = salto de página al imprimir, no pestañas de hoja nuevas.
- El ZIP no imprime solo; deja todo listo, imprimir sigue siendo un paso aparte.
- Fecha automática desde el Albaran (no se vuelve a preguntar), con el mismo salto de fin de semana de siempre.
- El pegado manual de Meco en TOP sigue existiendo, el ZIP es un camino nuevo, no sustituye nada.
- MECO en HODOS no lleva subtipo — solo origen, pedido (CMP) y destino.
- Fase 2 (pestaña dedicada en `hodos`) sí entra en el encargo, pero después de que la Fase 1 funcione.
