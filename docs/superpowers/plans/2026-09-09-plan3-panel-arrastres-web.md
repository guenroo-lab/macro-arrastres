# Plan 3 de 3 — MacroArrastres: interfaz web "Panel Arrastres"

**Goal:** Que el trabajo diario se pueda hacer entero desde una URL propia (sin abrir el Sheet): cajones de archivo, retenidos del día, envío de correos e impresiones sueltas — igual que hoy hace `Panel.html` (sidebar), pero accesible fuera del Sheet.

**Spec:** `docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md`, sección 5.E.

**Alcance de este plan:** solo las 4 secciones que la spec mete dentro del alcance de la web (Cajones, Retenidos, Envío, Impresiones sueltas). Cachés, Celdas del libro, Automatizaciones, Borrar contenido y Sugerencias se quedan solo en `Panel.html` (admin, no trabajo diario).

## Hallazgo clave de esta revisión

`SpreadsheetApp.getUi()` **lanza excepción** si se llama fuera de un contexto de Sheet abierto (menú/sidebar/diálogo). No existe fuera de eso — ni try/catch alrededor lo arregla de verdad como flujo normal, así que las funciones que la web va a llamar **no pueden** ser las que hoy abren `showModalDialog` para imprimir:

- `procesarArrastres()` y `procesarRecepcion()` (wrappers de Plan 2) SÍ llaman a `getUi().showModalDialog(...)` → rompen desde la web.
- `procesarCsvArrastre()` y `procesarXlsxRecepcion()` llaman a los anteriores por dentro → rompen igual.
- `procesarZipMeco()` (Meco) **ya es web-safe**: no llama a `getUi()` en ningún punto, devuelve `{htmlImpresion, hodos, faltan}` y es el propio cliente (`MecoZipForm.html`) quien hace `window.open` + `document.write`. Es el patrón a copiar.
- `htmlImprimirTOP`, `htmlImprimirCaratula`, `htmlImprimirPyxisArrastres`, `htmlImprimirPyxisRecepcion`, `anadirRetenido`, `listarRetenidosPedido`, `quitarSoportes`, `quitarPedido`, `vaciarRetenidos`, `enviarRetenidosTienda` — comprobados, **ninguno llama a `getUi()`**: reutilizables tal cual desde la web.
- `diagnosticoCeldas`, `recortarHojasAlContenido` sí llaman a `getUi()` — por eso quedan fuera del alcance de la web (coincide con la spec).

## Tareas

1. **`LockService` en los núcleos** (`_procesarArrastresNucleo_`, `_procesarRecepcionNucleo_`): una sola vez, adentro de cada núcleo (nunca en los wrappers, para no anidar locks). Si no consigue el candado en 10s, devuelve `{error:'Hay otro proceso en marcha, espera unos segundos.'}` — mismo texto que la spec.
2. **`procesarArrastresWeb()` / `procesarRecepcionWeb()`**: mismo núcleo, sin `showModalDialog`; devuelven `{mensaje, htmlImpresion}` (o `{error}`) para que el cliente haga `window.open`+`document.write`, igual que Meco.
3. **`procesarCsvArrastreWeb()` / `procesarXlsxRecepcionWeb()`**: se extrae un núcleo de volcado (`_volcarCsvArrastreEnTOP_` / `_volcarXlsxRecepcionEnTOP_`) reutilizado por la versión de siempre (llama a `procesarArrastres()`/`procesarRecepcion()`) y la nueva (llama a la variante `*Web`).
4. **`appsscript.json`**: añadir bloque `webapp` (`executeAs: USER_DEPLOYING`, `access: DOMAIN` — igual que HODOS).
5. **`Web.gs`** (nuevo): `doGet()` sirve `Web.html`.
6. **`Web.html`** (nuevo): 4 secciones —
   - Cajones: Meco (reutiliza la lógica de `MecoZipForm.html` tal cual), Arrastres CSV, Recepción XLSX (endpoints `*Web`), Antequera (dos pasos, como hoy: `volcarAntequeraTOP` + botón "Procesar arrastres" que llama a `procesarArrastresWeb()`).
   - Retenidos del día: mismo HTML/JS que la sección 2 de `Panel.html` (ya es web-safe).
   - Envío por correo: mismo JS que la sección 3 de `Panel.html`.
   - Impresiones sueltas: mismo JS que la sección 4 de `Panel.html` (`imprimir()`), reutilizando los 4 `html*`.
7. **Despliegue**: `clasp push`, luego `clasp deploy` (crea/actualiza el deployment de webapp — `clasp push` solo no republica una URL de webapp), y pasarle a Pedro el enlace `/exec`.

## Pruebas

Arneses de Node en `C:\Users\30081048\Desktop\skills\`, mismo patrón que Plan 2:
- Candado: núcleo con `LockService` simulado que falla `tryLock` → devuelve el error, no llama a HODOS ni escribe TOP.
- `procesarArrastresWeb`/`procesarRecepcionWeb`: no llaman a `getUi` (si el mock de `SpreadsheetApp.getUi` lanza, el test debe seguir pasando); devuelven `htmlImpresion`.
- `procesarCsvArrastreWeb`/`procesarXlsxRecepcionWeb`: mismo volcado en TOP que la versión de siempre; llaman a la variante `*Web`, no a la de diálogo.
