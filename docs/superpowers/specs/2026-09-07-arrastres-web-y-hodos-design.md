# Arrastres sin pegar: cajones de archivo, etiquetas automáticas en HODOS e interfaz web

Fecha: 2026-09-07
Proyectos afectados: `MacroArrastes` (script bound al Sheet) y `hodos` (webapp + Supabase)

## 1. Problema

Hoy el trabajo diario del almacén pasa obligatoriamente por el Sheet:

- **Valencia** y **Torija**: el usuario abre el CSV que manda Leroy Merlin, lo pega en la hoja TOP y pulsa "Procesar arrastres".
- **Antequera**: ya tiene cajón (PDF → TOP), pero después hay que pulsar "Procesar arrastres" a mano.
- **Meco**: ya está automatizado de punta a punta (ZIP → impresión CCM + etiquetas en HODOS).
- **Recepción**: se pega un archivo en TOP y se pulsa "Marcar pedidos a retener".

Y en todos los casos menos Meco, las **etiquetas de la app HODOS** se crean a mano: `procesarArrastres` deja
una hoja HODOS con `Tienda | Pedido` y alguien copia esos números a la app.

Objetivo: que el usuario **no pegue datos nunca**. Suelta el archivo que le llega y el sistema hace el resto
—volcado, proceso, impresión con carátula y alta de etiquetas en HODOS— desde una interfaz web propia, sin
necesidad de abrir el Sheet.

## 2. Alcance

**Dentro**

1. App HODOS: renombrar dos pestañas y crear un bloque "ARRASTRES" con cuatro (Meco, Valencia, Torija, Antequera).
2. MacroArrastres: enviar automáticamente a HODOS las etiquetas que hoy quedan en la hoja HODOS, troceadas por plataforma.
3. MacroArrastres: abrir la impresión (carátula + hojas) automáticamente al terminar el proceso.
4. MacroArrastres: cajón que acepta el CSV de Valencia/Torija y encadena todo el proceso.
5. MacroArrastres: cajón que acepta el XLSX de Recepción y encadena su proceso.
6. MacroArrastres: **interfaz web propia** ("Panel Arrastres", web app con su enlace) que reemplaza el uso
   diario del Sheet.

**Fuera**

- No se retira nada de lo que existe. El menú, el panel lateral y el pegado manual en TOP siguen funcionando
  igual, como red de seguridad. Todo lo nuevo es un camino adicional.
- TRAMECO no se manda a la app HODOS (decisión del usuario). Sigue saliendo solo en la hoja.
- La regla "el origen MECO debe cargarse completo por tienda" **no** se extiende a Valencia, Torija ni
  Antequera (decisión del usuario).
- Recepción entra en el alcance como cajón (§4.2), pero **sin carátula** y **sin etiquetas en HODOS**: es un
  proceso de retención en plataforma, no de arrastre.

## 3. Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Cuándo se crean las etiquetas en HODOS | Al terminar `procesarArrastres` | Es el primer momento en que existen: dependen del cruce con EAN, TOM, el catálogo CERAMICA y la regla LS-SIE. Al soltar el archivo todavía no se sabe qué pedidos pierden trazabilidad. |
| Rutina de trabajo | Una plataforma por pasada, limpiando TOP entre medias | Es como trabaja el usuario. El cajón limpia TOP antes de volcar. |
| Duplicados al reprocesar | No repetir dentro de la misma **expedición** | Un mismo pedido puede llegar varias veces el mismo día, pero siempre en expediciones distintas (dato del usuario, 2026-09-07). Deduplicar "por día" perdería la segunda entrega en silencio. |
| Impresión | Se abre sola al terminar: carátula + hojas | Mismo comportamiento que Meco, que ya le funciona. |
| Pestañas de arrastres en HODOS | Rótulo "ARRASTRES" y las cuatro debajo, indentadas | Se ve el grupo de un vistazo. |
| Transporte de las etiquetas | Generalizar el webhook de Meco | Un solo camino de código y una sola autenticación. |
| Acceso a la web | Cualquiera del dominio con el enlace, ejecutando con los permisos del propietario | Evita compartir el Sheet con nadie. |

## 4. Formatos de entrada

### 4.1 CSV de arrastres (Valencia y Torija)

Archivos de referencia: `Q_439ARR.CSV` (Valencia, `ALM_ORIGEN` = E439) y `Q_431ARR.CSV` (Torija, E431).

**El CSV encaja columna a columna con TOP (A..W, 23 columnas). No hay transformación.**

| # | Campo CSV | Columna TOP | Nombre en TOP |
|---|---|---|---|
| 0 | ALM_ORIGEN | A | Origen (`CFG.ORIGENES` lo traduce a Valencia/Torija) |
| 1 | EXPEDICION | B | Exp |
| 2 | RUTA | C | — |
| 3 | ACTIVIDAD | D | — |
| 4 | ALM_DEST | E | — |
| 5 | TIENDA | F | — (código E014/E036/E279) |
| 6 | NOMBRE | G | Tienda (MARBELLA/MALAGA/MIJAS — es el que usa `CFG.TIENDA_ARRASTRE`) |
| 7 | PROVEEDOR | H | Proveedor |
| 8 | PEDIDO_OMS | I | — |
| 9 | PEDIDO_PEG | J | Pegase |
| 10 | PEDIDO_PYX | K | Pyxis |
| 11 | FLUJO | L | Flujo |
| 12 | CMP | M | Agrupación |
| 13 | SSCC_CMP | N | SSCC Agrupación |
| 14 | EMB_CMP | O | — |
| 15 | SOPORTE | P | Soporte |
| 16 | SSCC | Q | SSCC |
| 17 | EMBALAJE | R | Tipo Soporte |
| 18 | *(sin título en el export)* | S | **LM** |
| 19 | PRODUCTO | T | EAN |
| 20 | DESCRIPCION | U | Articulo |
| 21 | UNIDADES | V | Unidades |
| 22 | P_C | W | Unid |

#### Tres trampas comprobadas en los archivos reales

1. **La cabecera del export viene incompleta.** La línea de títulos trae 22 nombres y todas las filas de datos
   traen 23 campos: falta un título entre `EMBALAJE` y `PRODUCTO`. Si el lector se guiara por los nombres de
   la cabecera, todo se desplazaría una columna a partir del LM. **El lector debe ir por posición, no por
   nombre de cabecera**, y escribir él mismo la fila de títulos correcta.

2. **Los archivos son Windows-1252, no UTF-8.** En el CSV de Torija aparecen `PELDAÑOS` y `16Ø`. Leerlos con
   el juego de caracteres por omisión (UTF-8) los rompe. Al pegar desde Excel esto no se nota porque Excel ya
   descodifica; leyendo el archivo directamente hay que declararlo.

3. **La columna 18 es el LM, aunque a veces traiga un código con prefijo `C`.** Verificado con datos reales:
   en el CSV de Torija hay 16 filas cuyo campo 18 mide 11 caracteres y empieza por `48`, que es exactamente
   lo que recorta el paso 0 de `procesarArrastres` ("recorte de códigos 48 en columna S"). El campo 19
   (`PRODUCTO`) llega relleno solo en las filas de actividad 439, y `procesarArrastres` lo sobrescribe en el
   paso 5 con el EAN del catálogo.

Datos adicionales: separador `;`, saltos de línea CRLF, sin BOM, campos rellenados con espacios a la derecha,
SSCC con apóstrofo delante (`'8424...`) que `_ssccLimpio_` ya elimina, y descripciones con `?` sueltos
(`PELDA?O`) que ya vienen así en el origen de Leroy Merlin — no es un problema de codificación nuestro.

### 4.2 XLSX de Recepción

Archivo de referencia: `facturacion-informe-07-09-2026-101614.xlsx`, una hoja, 36 columnas, 182 filas de datos
más la cabecera.

**También encaja columna a columna con TOP.** Las dos columnas que usa `procesarRecepcion` caen en su sitio:

| # | Columna del XLSX | Columna TOP | Uso en `procesarRecepcion` |
|---|---|---|---|
| 0 | Pedido | A | Clave Pegase contra TOM (`dictTOM`) |
| 2 | Tienda | C | Código `014`/`036`/`279`, el formato exacto de `CFG.TIENDA_RECEPCION` |
| 9 | Flujo | J | — |
| 33 | **Re-Tránsito** | **AH** | `no` dispara la expansión con TOM |

Las 36 columnas se escriben tal cual; `procesarRecepcion` trabaja con 39 (hasta AM) y ya rellena a la derecha
con su función `norm()`, así que no hay que inventar columnas.

#### Trampas de este archivo

1. **Los números vienen como coma flotante en crudo.** En el XML del XLSX el pedido es `8.1402761E7` y el
   proveedor `206957.0`. Al pegar desde Excel esto no se ve porque Excel ya los formatea. El lector debe
   convertir los valores enteros a texto sin notación científica antes de escribirlos, con el mismo criterio
   que ya usa `_lmNum_`: si no se hace, la clave Pegase de la columna A no cruza con TOM y el proceso no
   encuentra nada.

2. **La tienda `014` tiene un cero a la izquierda.** En el XLSX es texto, pero al convertir el archivo a hoja
   de cálculo (paso obligado para leerlo, ver más abajo) existe el riesgo de que se interprete como el número
   14 y deje de casar con `CFG.TIENDA_RECEPCION`. El lector normaliza rellenando con ceros a la izquierda
   hasta tres dígitos antes de comparar. Hay que cubrirlo con una prueba explícita.

3. **Hay fechas como número de serie** (`45538.90…` en "Fecha valor"). `procesarRecepcion` no las usa, así que
   no se tocan; solo hay que evitar que se escriban como el número crudo si algún día se aprovechan.

**Lectura.** Se reutiliza `_leerXlsxComoValores_` (`MecoHodos.gs`), que ya sube el archivo a Drive convertido
a hoja de cálculo, lee la primera pestaña y borra el temporal en un `finally`. No hace falta código nuevo de
lectura de XLSX.

## 5. Arquitectura

### A. App HODOS — pestañas

**Renombres (solo la etiqueta visible):**

- `INCPC` → **Incidencias PedidoCliente**
- `Prep. Pedidos` → **Peticiones de Reserva**

Los identificadores internos (`data-tab="incpc"`, `vistaIncpc`), los nombres de función (`cargarIncpc_`,
`obtenerEtiquetasPendientesIncpc`…) y el valor del campo `origen` en Supabase **no cambian**. Cambiarlos
dejaría huérfanas las etiquetas ya creadas.

**Bloque nuevo en la barra lateral**, debajo de las pestañas actuales:

```
ARRASTRES            <- rótulo, no es un botón
  Meco
  Valencia
  Torija
  Antequera
```

**Backend:** las tres funciones específicas de Meco en `IntegracionIncpc.gs`
(`obtenerEtiquetasPendientesMeco`, `htmlPendientesMeco`, `marcarImpresasMeco`) se sustituyen por una familia
parametrizada por origen: `obtenerEtiquetasPendientesArrastre(origen)`, `htmlPendientesArrastre(origen)`,
`marcarImpresasArrastre(origen)`, con `origen` validado contra la lista
`['MECO','Valencia','Torija','Antequera']` — grafías exactas comprobadas contra Supabase (2026-09-07):
"Cargar lote" ya deja crear Valencia/Torija/Antequera a mano desde hace semanas (738/341/565 etiquetas
existentes), con mayúscula solo en la inicial; únicamente MECO va en mayúsculas, por cómo ya lo hardcodeaba
la integración de Meco. Un origen no reconocido es un error, no una consulta abierta.
Las tres funciones de Meco se conservan como alias de una línea para no romper llamadas existentes.

### B. Envío automático de etiquetas

**Origen y expedición por línea.** `_generarHodos_` (en `Hodos.gs`) hoy devuelve contadores y escribe filas
`[Tienda, Pedido]`. Pasa a devolver también la lista de líneas con su procedencia:
`{ tienda, texto, origen, expedicion }`, donde `origen` sale de la columna A de TOP (ya traducida a
Valencia/Torija/Antequera/Meco en el paso 6) y `expedicion` de la columna B. Las líneas de TRAMECO llevan
`origen: null` y no se envían.

**Meco va por su camino.** Meco no pasa por `_generarHodos_`: sus etiquetas salen de
`_agruparPlatMalagaPorTienda_` (`MecoHodos.gs`), que hoy lee las columnas 0 (Cod. Tienda) y 3 (CMP) del xlsx
de PLAT MALAGA. Pasa a leer también la columna 2, **Expedición**, que ya está en el archivo y no se usaba.
Antequera la saca del `exp` que ya extrae del PDF y escribe en la columna B de TOP.

**Agrupación y envío.** Al terminar `procesarArrastres`, las líneas se agrupan por `origen + tienda` y se
manda un lote por grupo. El texto de cada línea va tal cual: el parser de la app (`parsearLotePedidos`) parte
por saltos de línea y no toca el contenido, así que las agrupaciones `ped+ped` y `ped+ped/soporte` que ya
genera `_generarHodos_` entran como una sola etiqueta, que es justo lo que se quiere.

**Webhook generalizado.** En `hodos/IntegracionIncpc.gs`:

- `registrarLoteMeco` pasa a ser `registrarLoteArrastre`, con los campos `origen` y `expedicion` en el payload.
- `registrarLoteMeco` se mantiene como alias que llama a la nueva con `origen: 'MECO'`.
- Se conserva la doble autenticación actual: cabecera `Authorization: Bearer <ScriptApp.getOAuthToken()>`
  (necesaria porque el despliegue de HODOS es `access: DOMAIN`) más el token compartido en el cuerpo.

**Guardar la expedición.** La tabla `etiquetas` de Supabase no tiene hoy dónde guardarla. Se añade una columna
`expedicion` de texto y **anulable**, y sus dos líneas de traducción en `hodos/EstructuraSheets.gs`
(`expedicion: f.expedicion` en `filaEtiquetaDesdeSupabase_`, y el `if (obj.expedicion !== undefined)` en
`filaEtiquetaHaciaSupabase_`). Como el mapa de ida solo escribe los campos definidos, las etiquetas creadas
desde la pantalla normal seguirán insertándose sin ese campo, y las etiquetas que ya existen se quedan con el
valor nulo. Ninguna pantalla cambia.

Es un cambio en la base de datos de producción. Va en su propio paso, antes que el código que la usa, y se
comprueba que la app sigue funcionando igual antes de seguir.

**Antiduplicado.** Sustituye a la ventana de 3 minutos de Meco, que sigue existiendo solo para el alias.
Antes de insertar, `registrarLoteArrastre` consulta las etiquetas de ese `origen` + `destino` + `expedicion`
y descarta los pedidos que ya estén. Devuelve `{ ok, idsCreados, omitidos }` para poder decir "12 nuevas, 3 ya
estaban".

Dos matices que hacen que la regla sea correcta:

- **La clave lleva la expedición, no la fecha.** Un mismo pedido puede llegar varias veces el mismo día, pero
  cada llegada es una expedición distinta, así que genera etiqueta nueva. Con una regla "por día" la segunda
  entrega se habría perdido sin avisar.
- **El texto del pedido se compara entero.** `99143242` y `99143242+99143337` son etiquetas distintas, y así
  debe ser: son dos etiquetas físicas diferentes.

Si una línea llega sin expedición (dato incompleto en el archivo de origen), no se deduplica: se inserta. Es
preferible una etiqueta de más, que se ve y se tira, a una de menos, que no se ve hasta que falta.

**Fallos parciales.** Igual que Meco hoy: si una tienda falla, las demás siguen. El resultado enumera qué
tiendas fueron bien y cuáles no, con el motivo.

### C. Impresión automática

Al terminar `procesarArrastres` se genera el HTML de impresión con `htmlImprimirCaratula` + `htmlImprimirTOP`,
con la carátula ya rellena (origen de la plataforma, número de transporte y fecha de llegada calculada con
`_fechaEnvioPorOrigen_`) y las hojas con el color alterno por Pyxis que ya se aplica hoy.

Se reutiliza el patrón de `_htmlImpresionCCM_` (`MecoAlbaran.gs`): una carátula como primera página y la clase
`salto` (`page-break-before: always` dentro de `@media print`) en las páginas siguientes.

**Excepción:** el proceso de Recepción **no lleva carátula** (decisión del usuario).

### D. Cajón de CSV de arrastres

Función `procesarCsvArrastre(base64, nombreArchivo)`, en un archivo nuevo `ArrastreCsv.gs`:

1. Descodifica el archivo como **Windows-1252**.
2. `Utilities.parseCsv(texto, ';')`.
3. Descarta la fila de cabecera del export (viene incompleta) y las filas que no tengan 23 campos,
   contándolas para avisar.
4. Deduce la plataforma del campo 0 (`ALM_ORIGEN`) vía `CFG.ORIGENES`. Si no la reconoce, aborta con un
   mensaje claro y **no toca TOP**.
5. Limpia TOP y escribe la cabecera canónica más las filas, todo con formato de texto (`'@'`) para no perder
   dígitos ni ceros a la izquierda.
6. Llama a `procesarArrastres`.
7. Devuelve `{ plataforma, filas, resumenProceso, htmlImpresion, hodos }`.

Antequera reutiliza los pasos 6 y 7 después de su volcado de PDF actual.

**Cajón de Recepción**, función `procesarXlsxRecepcion(base64, nombreArchivo)` en `RecepcionXlsx.gs`, con la
misma forma pero sus propias reglas:

1. Lee el XLSX con `_leerXlsxComoValores_`.
2. Comprueba que la cabecera trae `Pedido` en la columna 0 y `Re-Tránsito` en la 33. Si no, aborta sin tocar
   TOP: es la señal de que Leroy Merlin ha cambiado el informe.
3. Normaliza: enteros a texto sin notación científica, y tienda rellenada a tres dígitos.
4. Limpia TOP y escribe cabecera y filas con formato de texto.
5. Llama a `procesarRecepcion`.
6. Devuelve `{ filas, resumenProceso, htmlImpresion }`. **Sin carátula y sin envío a HODOS.**

### E. Interfaz web — "Panel Arrastres"

**Despliegue.** El mismo proyecto de Apps Script, con un `doGet` nuevo y una plantilla `Web.html`. Se despliega
como web app con `executeAs: USER_DEPLOYING` y `access: DOMAIN`. Así nadie necesita acceso al Sheet, pero
`Session.getActiveUser().getEmail()` sigue identificando a quien entra (mismo dominio) para el campo operario.

**Secciones**, todas alimentadas por archivo o por botón, ninguna por pegado:

1. **Cajones**: arrastres (CSV de Valencia/Torija), Meco (ZIP), Antequera (PDF), Recepción (XLSX).
2. **Retenidos del día**: ver por tienda, añadir y quitar. Reutiliza las funciones que ya usa `Panel.html`.
3. **Envío de correos**: Málaga, Marbella, Mijas.
4. **Impresiones sueltas**: carátula, hoja TOP, Pyxis de arrastres y Pyxis de recepción. Reutiliza
   `htmlImprimirCaratula`, `htmlImprimirTOP`, `htmlImprimirPyxisArrastres`, `htmlImprimirPyxisRecepcion`,
   que ya devuelven HTML.

**Refactor necesario.** `procesarArrastres`, `procesarRecepcion` y compañía terminan con
`SpreadsheetApp.getActive().toast(...)`, que no funciona fuera del Sheet. Se separan en dos capas:

- Un núcleo que calcula y **devuelve** el resultado, sin tocar la interfaz.
- Envoltorios finos: el del menú y el panel hace el `toast`, el de la web devuelve el objeto al navegador.

Es el cambio con más riesgo de esta entrega, porque toca código en producción que hoy funciona. Va primero y
con pruebas antes que nada más.

**Candado.** TOP es una hoja única y compartida. Todas las operaciones que escriben en TOP se envuelven en
`LockService.getScriptLock()` con espera corta; si no se consigue el candado, el usuario ve "Hay otro proceso
en marcha, espera unos segundos" en vez de pisar los datos de otro.

**Impresión desde la web.** El HTML de impresión se abre en una ventana nueva y se lanza `window.print()`,
igual que ya hace `Panel.html`.

## 6. Errores y casos límite

| Situación | Comportamiento |
|---|---|
| CSV con `ALM_ORIGEN` desconocido | Aborta antes de tocar TOP, dice qué código encontró |
| CSV con filas de distinto ancho | Se saltan y se cuentan en el resumen |
| CSV vacío o solo cabecera | Aborta, TOP intacta |
| Archivo que no es CSV en el cajón de arrastres | Aborta con mensaje, TOP intacta |
| XLSX de Recepción sin `Pedido` en 0 o `Re-Tránsito` en 33 | Aborta, TOP intacta, avisa de que el informe ha cambiado de formato |
| HODOS caído o token mal | El proceso y la impresión terminan igual; el resumen dice qué tiendas no se pudieron enviar y por qué |
| Reproceso del mismo archivo | Etiquetas no duplicadas; el resumen dice cuántas se omitieron |
| Dos personas a la vez | La segunda espera; si no hay candado en unos segundos, se le avisa |
| TOM no disponible en Drive | El error actual de `_leerTOMDesdeDrive_` se propaga tal cual a la web |

## 7. Pruebas

Con arneses de Node como los que ya existen para Meco (`test_meco_*.js`), que cargan los `.gs` en un contexto
con `SpreadsheetApp`, `Utilities` y `UrlFetchApp` simulados:

- **Lector de CSV**: mapeo de los 23 campos a TOP con filas reales de los dos archivos; cabecera de 22 campos
  ignorada; descodificación Windows-1252 (`PELDAÑOS`, `16Ø`); código `48…` de 11 dígitos intacto en la
  columna S antes del recorte; `ALM_ORIGEN` desconocido no toca TOP.
- **Lector de XLSX de Recepción**: `Pedido` llega como `81402761` y no como `8.1402761E7`; tienda `014`
  conserva el cero a la izquierda y casa con `CFG.TIENDA_RECEPCION`; `Re-Tránsito` cae en la columna 33;
  cabecera cambiada aborta sin tocar TOP.
- **Agrupación por plataforma**: líneas de HODOS de tres plataformas y tres tiendas producen un lote por
  combinación; TRAMECO queda fuera.
- **Antiduplicado**: un segundo envío idéntico (misma expedición) no crea etiquetas y las cuenta como
  omitidas; un pedido nuevo dentro del mismo lote sí entra; **el mismo pedido con otra expedición sí crea
  etiqueta nueva** — esta es la prueba que protege el caso real de dos entregas en un día; una línea sin
  expedición se inserta en vez de descartarse.
- **Fallo parcial**: una tienda que devuelve error no impide el resto.
- **Impresión**: una sola carátula, salto de página por tienda, color que cambia al cambiar el Pyxis.
- **Alias**: `registrarLoteMeco` sigue creando etiquetas con `origen: 'MECO'`.

Además, la comprobación de siempre antes de dar nada por bueno: `clasp pull` y comparación con lo local, para
no dar por desplegado lo que no lo está.

## 8. Orden de trabajo

1. Separar núcleo e interfaz en los procesos (base de todo lo demás).
2. App HODOS: renombres, bloque ARRASTRES, backend por origen.
3. Columna `expedicion` en Supabase y su traducción en `EstructuraSheets.gs`, comprobando que la app sigue
   igual antes de seguir.
4. Webhook generalizado con antiduplicado por expedición, y alias de Meco.
5. Origen y expedición por línea en `_generarHodos_` (y columna 2 del xlsx en Meco) y envío automático.
6. Impresión automática con carátula.
7. Cajón de CSV de arrastres.
8. Cajón de XLSX de Recepción.
9. Interfaz web "Panel Arrastres" con las cuatro secciones.

## 9. Riesgos a validar durante la implementación

1. **El refactor de núcleo e interfaz** toca `procesarArrastres` y `procesarRecepcion`, que están en
   producción y son el trabajo diario. Va primero, con pruebas, y el comportamiento desde el Sheet tiene que
   quedar idéntico.
2. **La conversión del XLSX a hoja de cálculo** puede cambiar tipos (el `014` de la tienda). Se cubre con una
   prueba explícita antes de fiarse.
3. **La columna nueva en Supabase** toca la base de datos de producción de HODOS. Es aditiva y anulable, pero
   va en su propio paso y con la app comprobada después, antes de escribir el código que la usa.
4. **Concurrencia sobre TOP**: verificar que el candado funciona de verdad con dos sesiones a la vez, no solo
   que el código lo llama.
