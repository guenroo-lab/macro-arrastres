# Proyecto: Macro Arrastres GAS v2

> Este archivo es la memoria del proyecto. Léelo entero al empezar cada sesión.

## Qué es

Migración de una macro de Excel/VBA (`MacroArrastres.xlsm`) a **Google Apps Script**, ligada a una
Google Sheet (script contenedor, **NO** es una web app independiente). Gestiona la operativa logística
de retenidos de la plataforma **Leroy Merlin Málaga / TAISA**: procesa arrastres (Valencia, Torija,
Antequera), recepción y Meco; marca y registra los pedidos a **retener** por tienda; envía correos de
retenidos; imprime hojas Pyxis/TOP; y genera informes semanales/mensuales.

Tiendas: **Málaga, Marbella, Mijas**. Flujos: **LS-SIE** (morado) y **CC** (verde).

## Usuario

Pedro Gil (`pedro.gil@ext.leroymerlin.es`), jefe de operaciones logísticas. No es programador: construye
estas apps de forma iterativa. Preferencias **importantes**:

- Responder **en español**, directo y sin relleno.
- Entregar **archivos completos listos para pegar**, nunca fragmentos sueltos.
- **No adjuntar el ZIP completo** en cada cambio: pasar **solo los archivos modificados**. El ZIP solo si lo pide.
- Preguntar antes de cambios de diseño.
- Corregir y profesionalizar los correos (tono formal, sin erratas, con tildes).

## Cómo trabajar en este proyecto (para Claude Code)

1. **Validar sintaxis** de cada `.gs` tras editarlo, con Node:
   ```bash
   node -e "const fs=require('fs'); new Function(fs.readFileSync('ARCHIVO.gs','utf8')); console.log('OK')"
   ```
   (Apps Script no es Node, pero `new Function` detecta errores de sintaxis JS. No uses APIs de Node en el código real.)
2. Para `Panel.html`: validar el `<script>` extrayéndolo y comprobar balance de `<div>`.
3. Tras editar, entregar a Pedro **solo los archivos tocados**.
4. No reintroducir el ZIP salvo petición expresa.

## Arquitectura y convenciones

- Un archivo `.gs` por función/área. Toda la configuración en **`Config.gs`** (objeto `CFG`).
- Menú unificado en **`Menu.gs`** (`onOpen()`), más un **panel lateral** `Panel.html` (sidebar HTML) que
  llama a las funciones del servidor con `google.script.run`.
- Helpers comunes: `t_()` (trim endurecido que quita NBSP/ZWSP/BOM), `esc_()` (escape HTML),
  `_ahora_()`, `_hoy_()`, `ultimaFilaCol_()`, `autoajustar_()`.
- **SSCC y pedidos siempre como texto** en las hojas (`setNumberFormat('@')`) para no perder dígitos ni
  caer en notación científica.
- **LM siempre numérico sin decimales**: se normaliza con `_lmNum_()` (entero) + `setNumberFormat('0')`.
  Columna LM por proceso: Arrastres = **S (19)**, Recepción = **AK (37)**, Meco = **K (11)**. Ojo: NO es
  texto (al revés que SSCC/pedidos); el usuario lo quiere como número entero.

## Sistema de diseño (interfaces)

Fondo `#080a10`, rojo acento `#e30613`, fuentes Bebas Neue + DM Sans, Font Awesome, glassmorphism.

## Archivos

| Archivo | Función |
|---|---|
| `Config.gs` | Objeto `CFG`: hojas, colores, tiendas, columnas, remitente, CC, destinatarios de informes, bloques de RETENIDOS, `APP_NOMBRE` y `SUGERENCIAS_PARA`. |
| `Menu.gs` | `onOpen()` y submenús. Abre el panel lateral. |
| `Proceso_Arrastres.gs` | Procesa arrastres (Valencia/Torija/Antequera): recorta códigos "48", marca VERDE/MORADO, ordena, colorea, **registra retenidos**, y regenera la hoja **HODOS** (`_generarHodos_`). Diccionario EAN cacheado 6 h (`_catalogoEAN_`). Lleva cronómetro (`Logger`). |
| `Hodos.gs` | Hoja **HODOS**: pedidos de cerámica SIN transporte, CC2 y LS que pierden trazabilidad + volcado de TRAMECO. Catálogo cerámico cacheado 6 h. |
| `Proceso_Recepcion.gs` | Procesa recepción: expande líneas con transporte "no" según TOM, marca VERDE, **registra retenidos** (1 por pedido). |
| `Proceso_Meco.gs` | Formato sobre la hoja TOP para Meco (no borra TOP). |
| `AntequeraPlan.gs` | Antequera v2: análisis de la expedición (3 PDF + TOM) palé por palé; ver sección "Antequera v2". `Antequera.gs` trae `volcarAntequeraLineasTOP` (+ la versión antigua). |
| `Retenidos.gs` | `registrarRetenidos_()` (alta sin duplicados por bloque/tienda), alta manual, cabeceras, localización de bloque por título. |
| `Envio.gs` | Envío de correos de retenidos por tienda. `enviarCorreo_(to,asunto,html,texto,ccExtra)`. |
| `Portada.gs` | Importa retenidos desde una hoja externa de "portada" (otro documento). |
| `Reset.gs` | Borrados: "Borrar TOP" y "Borrar todo" (este **NO** toca RETENIDOS). |
| `Flujos.gs` | **OBSOLETO** (Generix/FLUJOSTRA). Sustituido por HODOS. |
| `Impresion.gs` | Impresión directa sin PDF (abre ventana + `window.print`). TOP, Pyxis arrastres, Pyxis recepción. |
| `Automatizaciones.gs` | Crea/borra triggers: portada 12:30, borrado 3:00, informe semanal (lunes 7:00), informe mensual (día 1, 7:00). |
| `Informes.gs` | Histórico + informes semanal/mensual por email HTML (global plataforma + uno por tienda). |
| `Sugerencias.gs` | Módulo reutilizable de sugerencias/mejoras/fallos: `abrirSugerencias()` (diálogo) y `enviarSugerencia()` (correo a `CFG.SUGERENCIAS_PARA` con imagen opcional adjunta). |
| `SugerenciasForm.html` | Formulario del diálogo de sugerencias (categoría + texto + foto/recorte opcional). Nombre distinto a `Sugerencias.gs` porque Apps Script no admite dos archivos con el mismo nombre base. |
| `Panel.html` | Panel lateral con todos los botones. |
| `appsscript.json` | Manifiesto y scopes. |

## Reglas de negocio: RETENCIÓN

**Arrastres** (`Proceso_Arrastres.gs`):
- **VERDE (CC)**: flujo CCM, o la clave está en TOM con transporte = "SI". **CC2 nunca es VERDE** (aunque su clave coincida por casualidad con un "SI" en TOM): siempre va a tienda sin retener y siempre debe generar etiqueta HODOS.
- **MORADO (LS-SIE)**: pedido ≠ '' Y SSCC ≠ '' Y flujo = LS Y columna M vacía Y tienda Marbella/Mijas Y artículo en hoja FAMILIAS TIENDA.
- Tienda canónica desde columna G del nombre, **normalizando tildes** (`MÁLAGA`→`MALAGA`) para casar con `CFG.TIENDA_ARRASTRE`.
- SSCC (columna Q) se lee como **texto del valor mostrado** y se limpia con `_ssccLimpio_()` (quita decimales `.0`, separadores de miles, notación científica). Esto evita que el dedup `pedido|sscc` junte SSCC distintos que redondeaban al mismo número.

**Recepción** (`Proceso_Recepcion.gs`):
- Expande líneas con transporte "no" (col AH) según TOM, marca VERDE las válidas.
- Registra **1 retenido por pedido** (sin SSCC), tipo "Recepción".
- Código de tienda desde columna C normalizado con `parseInt` (`36`/`036`/`36.0`→`036`) contra `CFG.TIENDA_RECEPCION`.

**Tope de complejidad por soporte (implementado 2026-08-06)**: además de lo anterior, un soporte con
**más de 2 artículos distintos** (EAN si `dictEAN` lo resuelve, si no LM) entre sus **candidatas** (las
que ya cumplían pedido/LM/flujo LS/columna M vacía/tienda/FAMILIAS) **no se retiene nada de él** — sigue
"LS" y lo recoge HODOS por su regla 6. Si el soporte **sí pasa** (≤2 artículos), se marcan LS-SIE **TODAS**
sus líneas de flujo LS de esa tienda, aunque alguna no fuera candidata individualmente (p.ej. LM fuera de
FAMILIAS) — decisión confirmada por Pedro: la unidad de decisión es el SOPORTE, no la línea. Toast informa
de soportes bloqueados. Código en `Proceso_Arrastres.gs`, paso 7 (7a candidatas+conteo, 7b soportes que
pasan, 7c marcado ampliado). Sin implementar la columna M en el marcado ampliado (7c no la comprueba,
solo pedido/LM/flujo/tienda) — si eso no es lo que Pedro quería, revisar ahí.

## Hoja RETENIDOS (estructura)

9 columnas por bloque: `Tipo · Flete · Pedido · Pyxis · Agrupación · SSCC · Expedición · Enviado · Día`.
Tres bloques (uno por tienda) en columnas 1 (Málaga), 11 (Marbella), 21 (Mijas) — ver `CFG.RETEN_BLOQUES`.
El bloque se localiza por **título** en la fila 1 (`_colDeBloque_`).
- **Tipo** = origen (Valencia/Torija/Antequera/Recepción/Recepción de Portada).
- **Flete** = columna B de TOP, solo en arrastres.
- **Día** = fecha de salida calculada por origen (`_fechaEnvioPorOrigen_` + `CFG.DIA_POR_ORIGEN`).
- Alta sin duplicados: clave `tipo|pedido|pyxis|sscc` por bloque.

## Sistema de informes (`Informes.gs`)

- **Histórico**: cada soporte se guarda en la hoja **HISTORICO** al **enviar** los retenidos
  (`_guardarHistorico_` se llama desde `Envio.gs`). Columnas: `Fecha · Tienda · Flujo · Origen · Pedido · Pyxis · SSCC · DiaPrevisto`. Flujo = `LS-SIE` si Pyxis es "LS-SIE", si no `CC`.
- **Informe semanal** (lunes, semana anterior) y **mensual** (día 1, mes anterior), por **email HTML** oscuro compatible Outlook (tablas inline-styled).
- KPIs: **Soportes · Pedidos · LS-SIE · CC** (con flechas ▲▼ vs periodo anterior). **No** se muestran envíos ni "en plazo" (se quitaron a petición).
- Tabla por tienda + fila PLATAFORMA (global). Tabla de **Procedencia** (Origen · Soportes · Pedidos, desc).
- Cada informe lleva un **cuerpo introductorio** explicativo.
- Se envía: el **global** a `CFG.INFORMES_PARA`; y **un correo por tienda** a `CFG.INFORMES_TIENDA[tienda]` con CC = `CFG.INFORMES_CC`.
- **Málaga (informe por tienda)**: lista vacía a propósito → no se envía hasta que Pedro dé los contactos.

## Impresión (enfoque que FUNCIONA)

Para tablas anchas (hoja TOP), el enfoque bueno es: **tabla a ancho natural** (`width:max-content`) +
**escala JS a un ancho objetivo fijo** (`avail = 1160`, `transform: scale(target/w)`) +
**padding de ajuste** en el body (`padding-top`, `padding-left`). NO usar `table-layout:fixed`,
NO `position:absolute`. Está en `Impresion.gs` → `htmlImprimirTOP`. (Costó varias iteraciones; no volver a `table-layout:fixed` ni a escalas medidas contra el área de impresión.)

## Correo (config en `Config.gs`)

- Remitente: alias `administracion.alm-malaga@leroymerlin.es` (con fallback a la cuenta propia si el alias falla).
- `CC_FIJO`: copia fija en los correos de retenidos (incluye `administracion.alm-malaga@leroymerlin.es`).
- Cuerpo de retenidos: "Estos son los pedidos retenidos hoy en la plataforma de Málaga (N líneas). Por favor, proceded a su valoración:".
- Destinatarios reales de informes ya configurados (global + Marbella 17 / Mijas 6; Málaga pendiente).

## Automatizaciones (`Automatizaciones.gs`)

Botón "Activar automatizaciones" crea 4 triggers: `importarRetenidosPortada` (12:30), `borradoNocturno`
(3:00), `informeSemanal` (lunes 7:00), `informeMensual` (día 1, 7:00). "Desactivar" los borra.
Requiere scope `script.scriptapp`.

## Bugs resueltos importantes (no repetir)

- **SSCC con decimales / notación científica**: resuelto leyendo columna Q como `getDisplayValues()` + `_ssccLimpio_()` y formateando la columna como texto.
- **Se perdían retenidos en el registro**: causa = el dedup usaba el SSCC como número; al perder precisión, SSCC distintos se volvían iguales y se descartaban como duplicados. Resuelto con el SSCC como texto.
- **"Borrar todo" borraba los retenidos**: ya NO los toca (solo TOP/TOM/TRAMECO/FLUJOSTRA). Texto del botón y confirmación actualizados.
- **"Solo Málaga no se registraba"**: en realidad SÍ se registra; los retenidos quedaban **ocultos por un filtro** de la hoja RETENIDOS ("Se muestran X de Y filas"). Diagnóstico añadido al toast (VERDE vistas y nuevas/repetidas por tienda + códigos sin tienda). Además se endureció el mapeo de tienda (tildes en arrastres, `parseInt` en recepción) por si acaso.
- Diacríticos de "Málaga": normalizar con NFD donde se compare por nombre.
- `getDisplayValues()` en Portada para no desfasar la fecha por zona horaria.
- **CC2 se pintaba VERDE**: si su Pegase/Pyxis coincidía por casualidad con una clave de TOM con transporte "SI", se marcaba VERDE aunque fuera CC2 (visualmente engañoso: parecía que iba a ir trazado/retenido, y CC2 nunca se retiene). Resuelto excluyendo CC2 explícitamente de esa condición en `Proceso_Arrastres.gs`.
- **Carátula Meco mostraba el Flete en vez del nº de Optimus**: `_datosCaratula_` (Impresion.gs) leía columna C (Flete) para el "Nº transporte" bajo "Origen". Además, `procesarMeco` sobreescribía la columna A (que guarda el nº de Optimus) con el texto "Meco" — resto vestigial de una versión anterior de la detección de origen, ya innecesario porque la detección actual usa el bloque V1:V4 (V2='Meco'). Resuelto: `procesarMeco` ya NO toca la columna A, y `_datosCaratula_` lee de ahí (col A = Optimus) en vez de Flete.
- **`procesarArrastres` tardaba 2+ minutos**: causa = `ultimaFilaCol_` + la lectura completa de TOM y EAN. **EAN** (catálogo maestro, ~765.000 filas reales, nunca se borra) se leía entero en cada pasada — resuelto cacheándolo 6 h igual que CERAMICA (`_catalogoEAN_`, botón "Vaciar caché de EAN"). **TOM** (~52.000 filas) no era caché de datos reales sino pedidos acumulados de meses sin borrar — no es un bug de código: TOM está pensado para vaciarse con "🧹 Borrar todo" y no se estaba haciendo. Ver "Pendientes" más abajo.

## Hoja HODOS (trazabilidad de lo que NO se retiene)

Cada `procesarArrastres()` **reconstruye entera** la hoja **HODOS** (`CFG.HOJAS.HODOS`).
Sustituye a la antigua "Soportes Málaga" y al flujo TRAMECO -> FLUJOSTRA (Generix).

Columnas: **Tienda | Pedido**.

**Excepciones que entran SIEMPRE (sin pasar por cerámica ni transporte)**, cada una con su propio modo de agrupación:
- **CC2** (columna Flujo): siempre va a tienda sin retener, así que siempre necesita etiqueta. Se agrupa
  por soporte en las 3 tiendas, pedidos unidos con "+" (`ped+ped+ped`).
- **LS** (Torija) que **sigue siendo "LS"** (no las que el paso 7 de `Proceso_Arrastres` ya convirtió a
  "LS-SIE", esas se retienen y ya tienen traza vía RETENIDOS): se agrupa por **tienda (col G) + soporte
  (col P)**, usando el **Pedido (col J)**, no el Pyxis — un mismo pedido puede repartirse en varios
  soportes, así que sale **una línea por soporte** con formato `ped+ped/soporte`.
- **CC** (proveedor directo/Agrupación) que llega a TOP **sin Pyxis en columna K**: se recupera cruzando
  el Pedido (Pegase, col J) contra TOM (col M) — `_pyxisPorPegase_`. A partir de ahí sigue el camino normal
  (cerámica + transporte).

**Reglas de cerámica** (el resto de flujos que no son CC2/LS se ignora si no es cerámica):
1. LM en el catálogo de la hoja `CERAMICA` (Sección 6 filtrada, subsecciones 1,2,3,4,5,10,20,70,80).
2. Pyxis presente en TOM con **"Tiene transporte" = no**. Si tiene transporte o no está en TOM -> fuera.
3. Solo Málaga / Marbella / Mijas.
4. **Marbella y Mijas**: solo pedidos "99". Se agrupan **por soporte**: varios pedidos en el
   mismo soporte salen juntos como `ped+ped+ped` (una etiqueta de agrupación).
5. **Málaga**: los "99" entran siempre y **sueltos** (uno por línea, se separan físicamente);
   los que NO son "99" entran **solo si el soporte lleva más de un pedido** (si va solo ya tiene traza).

Si un mismo soporte recibe a la vez una línea CC2/cerámica-"junto" y otra que por sí sola sería
"malaga_no99", gana el modo más permisivo (`'junto'`) — CC2 siempre debe salir.

Además se vuelcan los pedidos de TRAMECO (antes iban a FLUJOSTRA con "M" delante):
ahora con el número limpio, **sin prefijo**, y solo E036/E014/E279 (E043 y E102 ya no se operan).

### LM: ojo con la columna S
Las filas de pedido de tienda (las que traen Pyxis, incluidas las "99") **no** llevan el LM en la
columna S: ahí viene un código interno con prefijo "C" (`C18133052`) y el LM real está en la
**columna T** (`90323676`). `procesarArrastres` solo copia T sobre S en las filas VERDE, y HODOS
trabaja con las que **no** son verde, así que lo resuelve `_lmDeFila_()`.

### Catálogo cerámica y caché
La hoja `CERAMICA` tiene ~63.000 LM. Leerla en cada pasada es lento, así que se cachea 6 h
(`CacheService`, troceada por el límite de 100 KB por valor). Tras editar la hoja hay que usar
**"Vaciar caché de cerámica"** (menú ⑤ CACHÉS o panel) para que se relea.

## Catálogos con caché (menú/panel ⑤ CACHÉS)

Dos catálogos maestros grandes que se leen en `procesarArrastres()`/HODOS se cachean 6 h vía
`CacheService` (texto trocado en trozos <100 KB, patrón idéntico en ambos):
- **CERAMICA** (`_catalogoCeramica_`, Hodos.gs) — ~63.000 LM. Botón "Vaciar caché de cerámica".
- **EAN** (`_catalogoEAN_`, Proceso_Arrastres.gs) — ~765.000 filas, catálogo maestro que Reset.gs
  **nunca borra**. Leerlo entero cada pasada era el mayor cuello de botella de `procesarArrastres`
  (>1 min de los ~2 min totales). Botón "Vaciar caché de EAN".

Si editas cualquiera de las dos hojas y quieres que el cambio se note ya (no esperar 6 h), usa el
botón correspondiente. Ambas funciones degradan con seguridad: si la caché falla o está incompleta,
releen la hoja sin más (try/catch alrededor de lectura y escritura de caché).

## Pendientes / a vigilar

- **Filtro de RETENIDOS**: valorar que la macro quite el filtro automáticamente al registrar (Pedro lo confirmará). Si no, avisarle de que el filtro oculta retenidos.
- **Málaga informe por tienda**: faltan los destinatarios.
- **Regla LS-SIE ≤2 artículos por soporte**: definida, sin implementar.
- **TOM acumulado**: al 2026-08-06 tenía ~52.000 filas (meses de pedidos sin borrar) en vez de solo
  los del día. TOM está pensado para vaciarse con **"🧹 Borrar todo"** (borra TOP+TOM+TRAMECO, conserva
  RETENIDOS/EAN/FAMILIAS) — recordar a Pedro usarlo con regularidad, si no vuelve a acumular y ralentiza
  `ultimaFilaCol_`/la lectura de TOM en cada pasada.

## Antequera v2 (2026-10-05) — `AntequeraPlan.gs` + cajón de `Web.html`

Cada expedición Antequera→tienda llega en **3 PDF**: Resumen de albaranes (base), Detalle de contenidos
entregados y Relación de bultos 1ª recepción. Se leen en el navegador (pdf.js) y el servidor
(`analizarAntequera`) devuelve la **vista previa palé por palé** sin escribir nada; "Procesar Antequera"
vuelca a TOP (`volcarAntequeraLineasTOP`) y llama a `procesarArrastresWeb`.

- **Identidad del palé = SOPORTE del Resumen/Bultos** (el de la etiqueta "SOPORTE PICKING"; el SSCC de
  18 dígitos lo lleva dentro: `493000002` + soporte + dígito de control GS1). El "Contenido" del Detalle
  en palés de proveedor es otro número que no está en ninguna etiqueta. En RETENIDOS el "SSCC" es el soporte.
- **Base = Resumen** (todas las líneas). El Detalle solo enseña UN pedido por palé (el de la última línea).
- **Dos flujos en el Resumen**: STOCK (preparado en Antequera: REFERENCIA = código logístico "C…", LM en
  REFLM, pedido+cliente en MENSAJE) y TRÁNSITO (proveedor: LM en REFERENCIA, sin pedido -> se busca en TOM
  por LM + unidades + tienda; el Pegase/Pyxis del Detalle desempata). Todos los CC tienen pedido de cliente.
- **Reglas (Pedro)**: se retiene el PEDIDO con transporte (TOM, por Pyxis — `Proceso_Arrastres` paso 2 tiene
  rama propia para origen "Antequera"); todo lo demás lleva etiqueta HODOS, **una por palé, solo pedidos**
  (varios = agrupación "ped+ped"; `_generarHodos_` regla 7). Palé mixto: se retiran los de transporte y la
  etiqueta lleva los demás. Lo que no case = REVISAR (nunca se descarta en silencio).
- **TOP**: una fila por línea del Resumen; J (Pedido) = Pegase o, si no se conoce, Pyxis (J no puede ir
  vacía: `ultimaFilaCol_` la usa para saber dónde acaba TOP); S = LM tal cual del PDF (los "48…" con sufijo
  los recorta el paso 0, NO recortar antes); Q = soporte.
- **Unidades, EAN y proveedor (2026-10-05, Pedro)**: en TOP las cabeceras son V(21)="Unidades" (la que imprime
  la hoja TOP, A..V) y W(22)="Unid" (la que lee el Control de pedido). Antequera pone en AMBAS las unidades
  ENVIADAS del Resumen (no la cantidad pedida de TOM) y la EAN13 del Resumen en T (la hoja EAN solo la completa
  si el Resumen no la trae, p. ej. códigos "48…"); `procesarArrastres` no las pisa para origen Antequera. I(8)=
  Proveedor: **493 en STOCK** (stock propio de Antequera); en TRÁNSITO el de la columna ENTREGA del Detalle
  (limpio: "ECOCERAMIC (" -> "ECOCERAMIC"), por el Pegase de la línea. La columna I se oculta salvo si hay
  Antequera. El Control de pedido (`htmlImprimirPyxisArrastres`) de Antequera añade PALÉ y PROVEEDOR y SUMA las
  unidades de un mismo LM; el resto de orígenes sale idéntico (prueba de regresión).
- **Trae / Pide / Sobrante (2026-10-05, Pedro)**: V=**Trae** (unidades enviadas, Resumen), W=**Pide** (lo que pide el
  pedido: suma de TOM por pedido+LM) y X=**Dif** (+ sobrante / − faltante, solo en la última línea del grupo
  pedido+LM). Si trae MÁS de lo que pide, el exceso no corresponde a ningún pedido: etiqueta HODOS propia
  `SOBRANTE+3 UDS+LM 95237762+PED 986016` (`_generarHodos_` regla 7; se crea aunque el pedido se retenga). Si trae
  menos solo se avisa (puede ser entrega parcial). La vista previa tiene una casilla «Crear etiqueta de sobrante»
  (desmarcada = no se crean). Ojo: si TOM y Resumen usan unidades distintas (p. ej. packs de 100 UD) saldrá un
  sobrante falso — se ve en la vista previa antes de procesar. Cabeceras V/W/X = Trae/Pide/Dif. **La columna Dif
  (X) NO se imprime y se oculta en la hoja** (Pedro: no la quiere), pero se conserva con sus datos porque
  `_generarHodos_` la lee para la etiqueta de sobrante. La impresión de Antequera llega hasta W (Trae · Pide) y
  salta las columnas vacías. OJO: hay DOS impresiones de la hoja TOP, `htmlImprimirTOP` (botón) e
  `_htmlImpresionArrastres_` (la automática al terminar de procesar, con carátula); las dos usan
  `_limiteImpresionTOP_()` (Antequera 23, resto 22) y `_ocultarColumnasVacias_`. En Antequera también se
  ocultan en la hoja las columnas vacías (H, Agrupación, SSCC Agrupación, Tipo Soporte).
- **CERÁMICA EN MÁLAGA = UN SOPORTE POR PEDIDO (2026-10-05, Pedro)**: solo en la tienda **Málaga**, nunca puede haber
  una agrupación de cerámica con pedidos distintos. Un palé de Málaga que lleve cerámica (algún LM en la hoja
  CERAMICA; `_catalogoCeramica_`, en caché 6 h; sin catálogo se asume que TODO es cerámica y se avisa) y MÁS DE UN
  pedido (retenidos o no) se marca `dividir` en el análisis (aviso + recuadro «Dividir en N soportes» en la vista
  previa + KPI «a dividir por pedido») y sus etiquetas HODOS son UNA POR PEDIDO no retenido (`295838`, `295839`),
  nunca `295838+295839` (`_generarHodos_` regla 7, mapa `antMalaga`; el resumen de procesar cuenta
  `antDivididos`). Los palés de Málaga SIN cerámica siguen como agrupación; Marbella y Mijas no cambian. Es el mismo
  criterio que ya usaba la regla 5 de Málaga para cerámica no-Antequera (pedidos separados, una línea cada uno).
- **Columna Tienda**: F(5) = "036 Málaga" / "014 Marbella" / "279 Mijas" (número + nombre); G(6) "Nombre" se queda con el
  nombre solo (la lógica lo usa) pero se OCULTA en Antequera.
- **Hodos (pestaña)**: listado premium agrupado por tienda + expedición (HODOS devuelve `expedicion` desde v92),
  tarjetas con cada pedido como ficha, "Agrupación · N pedidos", tarjeta especial de SOBRANTE, resumen arriba y
  selección por grupo. **Nunca `confirm()/alert()/prompt()` del navegador** (Pedro, 2026-10-05): usar
  `confirmarModal` (Web.html y Panel.html).
- **VARIAS EXPEDICIONES A LA VEZ (2026-10-05, Pedro)**: se pueden subir de golpe los PDF de 1, 2 o 3 tiendas (hasta 9;
  nunca obligatorio). El cliente (bloque `ANQ-PURO` de `Web.html`: `itemsDePdf`, `claveEnvio`, `repartirResumen`,
  `mezclarEnvios`, `listaEnvios`) reconoce cada PDF por su contenido y lo asigna a su **envío = expedición** por su
  cabecera (un Resumen con filas de dos tiendas se reparte); da igual el orden de subida. Antes (v54 y anteriores)
  se quedaba con el ÚLTIMO PDF de cada tipo y descartaba el resto SIN avisar. Servidor: `analizarAntequeraVarias`
  (`AntequeraPlan.gs`) lee TOM y el catálogo de cerámica UNA vez y devuelve un plan por expedición; una con error no
  tumba las demás; el mismo soporte en dos expediciones avisa. Vista previa: una sección por expedición con el color
  de su tienda + barra total. «Procesar Antequera» vuelca TODAS las líneas en TOP de una vez y lanza
  `procesarArrastres` UNA vez (retenidos con el flete de cada expedición, lotes HODOS por tienda+expedición).
  Expediciones sin Resumen salen en rojo y piden confirmar (`confirmarModal`) antes de procesar las demás. Tras
  procesar, la siguiente subida empieza de cero (`procesado`); enlace «Vaciar los PDF cargados» para empezar a mano.
  **Carátula: UNA POR EXPEDICIÓN** (`_datosCaratulas_` / `_caratulasFragmento_`, con «Tienda: 036 Málaga» en la
  cabecera roja), tanto en la impresión automática como en el botón de carátula; el resto de orígenes imprime
  exactamente lo de siempre (prueba de regresión). OJO: `RETENIDOS` pone un bloque por tienda en columnas contiguas
  (Málaga A.., Marbella K.., Mijas U..).
- **Etiqueta HODOS de Antequera con Nº DE PEDIDO PROVEEDOR (2026-10-06, Pedro)**: además del pedido cliente, la etiqueta
  que va a tienda lleva en su línea de abajo, bajo «ANTEQUERA», `PED. PROV. 81406165` (el Pegase = «Nº pedido proveedor»
  de TOM; Pedro eligió este dato y esta posición, no el nombre del proveedor). Pegase de cada línea: el del Detalle/TOM en
  tránsito y, si no lo trae (stock, resuelto por el Mensaje), el de TOM para ese Pyxis+LM (`l.pegaseProv` en
  `AntequeraPlan.gs`; NO se toca `l.pegase`, que sigue siendo el «Pedido» de TOP/RETENIDOS). Viaja en la col **Y(24)
  «PedProv»** de TOP (oculta como la X, nunca impresa). `Hodos.gs` (`_sufijoPedProv_`: varios sin repetir con « / »,
  máx. 3 y « +N») lo pone en `lineas[].sufijo` de cada etiqueta (palé, agrupación, una-por-pedido de la cerámica de Málaga y
  SOBRANTE); `ArrastresHodos.gs` manda `sufijosOrigen` (array alineado 1:1 con `pedidosTexto`; la clave solo existe si
  hay alguno → el resto de orígenes manda exactamente lo de siempre). HODOS (v93, `IntegracionIncpc.gs`/`Backend.gs`) lo
  guarda como `origenTexto = "ANTEQUERA · PED. PROV. …"` (sin columna nueva), pinta la línea de abajo aparte y más pequeña
  (`.origen-prov`) y compacta el interlineado en grupos de 4-5 pedidos para que quepa. Sin Pegase la etiqueta sale como
  siempre. La pestaña Hodos del Panel muestra el dato como chip en cada tarjeta.
- Antequera NO sirve a Granada. El diálogo antiguo del menú (`AntequeraForm.html` + `volcarAntequeraTOP`)
  sigue vivo pero pierde los palés sin Pegase y ahora avisa: usar el Panel Arrastres.
- Pruebas (fuera del repo, `Proyectos\_scratch\`): `test_antequera_v2.js` (análisis), `test_antequera_e2e.js`
  (TOP → retenidos → HODOS con TOM real), `test_antequera_cliente.js` (PDF reales + pdf.js, incluye las 120 formas
  de ordenar 5 PDF de 2 tiendas), `test_antequera_multi.js` (3 expediciones punta a punta + carátulas),
  `test_regresion_otros_origenes.js` (Valencia/Torija/Meco idénticos a HEAD, incluidas carátula e impresión),
  mutaciones: `mut_multi.js`, `mut_dividir.js`; despliegue: `deploy_panel.ps1`.

## Sugerencias / mejoras / fallos (`Sugerencias.gs` + `SugerenciasForm.html`)

Botón "💡 Enviar sugerencia o fallo" en el panel (sección 8) y en el menú. Abre un
diálogo con **categoría** (Sugerencia/Mejora/Fallo), **texto** y **foto/recorte opcional**.
`enviarSugerencia()` manda un correo a `CFG.SUGERENCIAS_PARA` (Pedro), con `replyTo` =
usuario que la envía y la imagen como adjunto. Es un **módulo reutilizable**: para llevarlo
a otra app, copia los dos archivos y ajusta `APP_NOMBRE` y `SUGERENCIAS_PARA` en su Config.
Depende solo de `esc_()` y del scope `script.send_mail` (ya presente).

## Meco (orden y carátula)

`procesarMeco` ordena por el **pedido Pyxis** (columna P) de forma **numérica** cuando los
valores son números (`_cmpPyxis_`), no alfabética. El color alterna por ese mismo Pyxis.

`procesarMeco` **no toca la columna A** (guarda el nº de **Optimus**, referencia de envío). El origen
"Meco" para la carátula sale del bloque de información V1:V4 (V2='Meco'), no de traducir esa columna.
La carátula (`_datosCaratula_`, Impresion.gs) muestra ese nº de Optimus (col A) como "Nº transporte"
bajo "Origen" — en el formato Arrastres normal, en cambio, ese campo sí sale de Flete (columna C).

### ZIP de Meco: una tienda sin archivos NO bloquea (2026-10-06)

`procesarZipMeco` (`MecoZip.gs`; lo llaman el cajón de `Web.html` y el diálogo `MecoZipForm.html`) hace lo que el ZIP
trae y se salta lo que no trae. Pedro: «si no existen archivos de una tienda no se hace esa tienda y listo» (antes
cualquier carpeta ausente, p. ej. `CCM/E279` cuando Mijas no manda nada, devolvía «Faltan archivos» y no hacía NADA).
- Sin carpeta `CCM/Exxx` (o con su Albarán sin líneas): esa tienda no se imprime y sale un aviso informativo en `avisos`.
- Sin el Excel de PLAT MALAGA (o sin pedidos de ninguna tienda conocida): el CCM se imprime y no se crean etiquetas HODOS (aviso).
- `faltan` (rechazo) solo si el ZIP no trae NADA que procesar. Respuesta: `{faltan, avisos, htmlImpresion, hodos, tiendasCcm}`,
  con `htmlImpresion`/`hodos` = null si esa parte no se hizo (las dos pantallas lo tratan).
- La fecha de llegada sale del Albarán de E036 si está (como siempre) y, si no, de la primera tienda con líneas.
- El Excel de PLAT MALAGA va por su cuenta: si trae pedidos de una tienda se crea su etiqueta aunque su carpeta de CCM falte.
- Pruebas (fuera del repo, `Proyectos\_scratch\`): `test_meco_zip_tiendas_ausentes.js` (ZIP reales de Downloads\R-*.zip, HEAD
  idéntico en ZIP completos) y `mut_meco_zip.js` (17 mutaciones, todas deben morir).

## Despliegue (clasp)

Ver `README_CLAUDE_CODE.md`.
## TOM desde Drive (`TOMDrive.gs`) — usa SIEMPRE el último CSV que haya (2026-10-08)

`_leerTOMDesdeDrive_` lee el CSV de TOM de la carpeta de inventarios (id en `TOM_DRIVE_CARPETA_ID`; la misma carpeta de los
`036/014/279/043.xlsx`). Lo usan TODOS los procesos (Valencia/Torija, Meco, Recepción, Antequera).

**Causa real del fallo «TOM (Drive): no encuentro en la cabecera estas columnas: pyxis, transporte, referencia, …» (7 y 8/10):**
el CSV pasó a ser el informe **«Pedidos Vivos con líneas»** (subida a mano del export de la web de TOM: UN solo BOM, no los dos del
robot): delante de la cabecera lleva una **línea de título** («Pedidos Vivos con lineas:fecha entre 2025-09-01 y 2026-10-07, tienda:
('14','36','279'), estado: (…),») y una línea en blanco, y la cabecera trae **124 columnas** (las 110 de siempre, mismo orden, + 14
«Infolog»). La lectura daba por hecha la cabecera en la 1ª fila. El CSV del robot (110 columnas, sin título) sigue valiendo: se
aceptan los dos. Comprobado con la muestra real (prueba `test_tom_drive.js`: el código anterior falla con ESA muestra con el
mensaje exacto de Pedro).

Qué hace ahora: (1) **candidatos = todos los CSV de la carpeta, el más reciente primero** (por fecha de modificación, se llamen como se
llamen: una subida a mano puede llevar otro nombre), ignorando los `.xlsx` y **`pedidos_totales_2.csv`** (otro informe, ~100 MB, lo
lee INCPC; no cabe en memoria); (2) para cada uno prueba UTF-8 → UTF-16 → ISO-8859-1; (3) separador = el que más aparece en las
primeras líneas (`_detectarSeparadorTOM_`; un título con comas ya no lo engaña); (4) la cabecera se busca en las 40 primeras filas y
se descartan las de antes; (5) nombres de columna normalizados (`_normCabeceraTOM_`: sin acentos, «Nº»/«N°»/«No», mayúsculas,
comillas); (6) si el más reciente no sirve, prueba el anterior; (7) **aunque el TOM no esté actualizado se usa igualmente** (Pedro:
«el último que esté en el directorio») y se AVISA (`_avisoTOMAntiguo_`, a partir de 6 h o si hubo que saltarse archivos): primer
aviso del análisis de Antequera y principio del resumen de procesarArrastres; (8) si TODO falla, el error dice qué ha leído (archivo,
bytes, hora, filas, columnas, separador y las primeras celdas de la cabecera). Con el CSV de siempre el resultado es idéntico al de
antes (comparado con el código v57). Pruebas: `_scratch\test_tom_drive.js`, `test_antequera_multi.js` (avisos), `mut_tom.js` (15 mutaciones).

**Dos orígenes del CSV, mismo nombre (`pedidos_totales.csv`), contenido DISTINTO** (comparado con muestras reales de Drive):
| | robot (`TOM_bucle.ps1`, cada 4 h) | subida a mano (export de la web de TOM, «Pedidos Vivos con líneas») |
|---|---|---|
| BOM / título | dos BOM, SIN título | un BOM + línea de título + línea en blanco |
| columnas | 110 | 124 (las 110 en el mismo orden + 14 «Infolog») |
| tiendas | 14, 36, 279 **y 43 (Granada)** | solo 14, 36 y 279 (**sin Granada**) |
| ventana | último año | desde la fecha que se ponga (p. ej. 2025-09-01) hasta el día del export |
Los dos se leen. Lo único que cambia el resultado es la **cobertura de tiendas**: Granada (043) solo se procesa en **Recepción**
(`TIENDA_RECEPCION`); Arrastres/Antequera/Meco solo sirven a Málaga, Marbella y Mijas. Con el export manual, los pedidos de
Granada en Recepción no se coteja­ban ni se retenían SIN avisar; ahora `_tiendasEnTOM_` anota qué tiendas trae el TOM
(`fuente.tiendas`) y `_avisoTOMSinTiendas_` avisa («El TOM usado … NO trae pedidos de Granada (43)…») en Recepción (mensaje), en
procesarArrastres y en el análisis de Antequera, solo si el TOP/expediciones que se procesan usan esa tienda. Prueba de Recepción con
hojas simuladas: `_scratch\test_recepcion_tom.js` (Granada: 0 VERDE con el manual, 1 con el del robot).
