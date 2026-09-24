# Macro Arrastres — versión 2

Migración de las macros de Excel a Google Apps Script: menú reorganizado, panel de
botones, **registro único de retenidos con añadir/quitar** y **envío por correo a cada
tienda**. El borrado del contenido es **manual** (un botón), sin automático.

## Instalación

1. Abre el Google Sheet → **Extensiones → Apps Script**.
2. **Borra los archivos de la versión anterior** (los `.gs` antiguos y su `Panel.html`).
3. Crea los archivos con el MISMO nombre y pega el contenido:
   - Scripts (`.gs`): `Config`, `Menu`, `Proceso_Arrastres`, `Proceso_Meco`,
     `Proceso_Recepcion`, `Retenidos`, `Envio`, `Portada`, `Reset`, `Flujos`,
     `Impresion`, **`Automatizaciones`**.
   - Archivo **HTML**: `Panel` (al crearlo elige tipo *HTML*; no escribas la extensión).
   - Manifiesto: pega `appsscript.json` (Proyecto → ⚙ → "Mostrar appsscript.json").
4. Guarda, recarga el Sheet y aparecerá el menú **📦 Arrastres**.
5. La primera vez pedirá permisos (incluye **enviar correo** y **crear automatizaciones**).
6. **Importante al actualizar:** la hoja RETENIDOS tiene una columna nueva (**Día**).
   Pulsa una vez **Vaciar retenidos del día** (o bórrala) para que se recree con el
   formato nuevo. Si dejas datos antiguos sin "Día", el envío no sabrá a qué día van.
7. En el panel, sección ⑥, pulsa **Activar automatizaciones** una sola vez.

## Cómo se usa

Abre **📦 Arrastres → 🎛 Abrir panel de control** y trabaja con los botones, o usa el
menú. También puedes poner los botones **directamente sobre la hoja** (ver el último
apartado). Todo avisa con un mensaje emergente (toast).

### ① PROCESAR
| Botón | Hace |
|---|---|
| 🟢 Arrastres | Cotejo TOP+TOM+EAN y pintado de **Valencia · Torija · Antequera** (VERDE + LS-SIE), y registra retenidos |
| 📥 Marcar pedidos a retener | Recepción: marca/pinta los pedidos a retener y los registra |
| 🚛 Meco | **Solo aplica el formato visual** (ordena por pedido, colorea, oculta columnas, pone fecha/hora). **No hace cotejo**: esos pedidos ya tienen gastos de envío |

### ② RETENIDOS DEL DÍA
Una sola hoja **`RETENIDOS`** con un bloque por tienda (**Málaga, Marbella, Mijas**).
Columnas: Tipo · **Flete** · Pedido · Pyxis · Agrupación · SSCC · **Expedición** · **Enviado** · **Día**.
- **Tipo** = el **origen** del retenido: en arrastres sale **Valencia / Torija / Antequera**
  (según la columna A de cada línea); portada sale como **Recepción de Portada**.
  Los orígenes se editan en `Config.gs → ORIGENES`.
- **Día** = **fecha de salida a tienda**, se calcula **sola** según el origen
  (`Config.gs → DIA_POR_ORIGEN`): Valencia y Torija → **mañana**; Antequera, Recepción y
  Recepción de Portada → **hoy**. Lo no listado sale hoy.
- **Expedición**: la rellenas tú a mano.
- **Enviado**: lo sella el botón de envío.
- **➕ Añadir** / **➖ Quitar** (soporte suelto o pedido completo) desde el panel.
- La **importación de portada** ya **no tiene botón**: se ejecuta **sola a las 12:30**
  (ver ⑥ Automatizaciones). Trae los retenidos de hoy de Marbella/Mijas: columna **A** fecha,
  **B** tienda, **C** pedido, **F** SSCC, Pyxis siempre **LS-SIE**. Solo **lee** ese
  documento (`Config.gs → PORTADA_SHEET_ID`); no lo modifica.

### ③ ENVIAR retenidos por correo
Un botón por tienda. Manda solo lo pendiente **del día de hoy** (lo de mañana espera),
avisa si falta Expedición y marca "Enviado dd/mm hh:mm" (no borra).
- **Remitente:** `administracion.alm-malaga@leroymerlin.es` (debe estar como **"Enviar
  como"** en tu Gmail; si no, sale desde tu cuenta y el panel te avisa).
- **CC fijo** (8) y **destinatarios** por tienda están en `Config.gs`.

### ④ IMPRIMIR (PDF)
- 🖨 **Imprimir pedidos Pyxis arrastres** (Módulo 10)
- 🖨 **Imprimir pedidos Pyxis recepción** (Módulo 11)
- 📄 **Imprimir hoja TOP** — un solo botón: imprime la hoja TOP tal cual, en **horizontal**
  y ajustada a una página de ancho.

### ⑤ TRAMECO
🚚 **Crear TraMeco** (antes "copiar flujos"): vuelca los códigos a FLUJOSTRA.
**Generix Infolog (Módulo 14) no se puede migrar** (usa SendKeys sobre el programa de
escritorio); mantén ese paso en el Excel.

### ⑥ AUTOMATIZACIONES Y BORRADO
- ▶️ **Activar automatizaciones** (una sola vez): crea dos tareas que corren solas cada día.
  - **12:30 mediodía** → importa sola los retenidos de portada.
  - **3:00 madrugada** → **borrado nocturno**: borra TOP, TOM, TRAMECO y FLUJOSTRA, y de
    RETENIDOS quita **solo lo ya Enviado**; lo no enviado **perdura** de un día para otro.
  - Google dispara estas tareas en una franja cercana a la hora (no al minuto exacto).
- ⏹️ **Desactivar automatizaciones** las quita.
- 🩹 **Borrar solo TOP** (manual): limpia solo la hoja TOP.
- 🧹 **Borrar todo el contenido** (manual): limpia TOP, TOM, TRAMECO y FLUJOSTRA.
  **Conserva RETENIDOS** (los pedidos retenidos no se pierden) y **no toca EAN ni
  FAMILIAS TIENDA**. Es la opción "a fondo" del contenido de trabajo del día.


### ⑦ SUGERENCIAS
💡 **Enviar sugerencia o fallo** (panel sección 8 y menú). Cualquiera del equipo puede
escribir una **sugerencia, mejora o fallo**, adjuntar una **foto o recorte** (opcional) y
enviarlo. Llega por correo a **Pedro** (`Config.gs → SUGERENCIAS_PARA`); al responder el
correo se contesta directamente a quien lo mandó. Para reutilizarlo en otra app: copia
`Sugerencias.gs` y `SugerenciasForm.html` y cambia `APP_NOMBRE` y `SUGERENCIAS_PARA`.

## Botones directamente en la hoja

Si quieres pulsar todo desde la propia hoja sin abrir el panel:

1. **Insertar → Dibujo**, haz un rectángulo con el texto del botón y **Guardar y cerrar**.
2. Selecciona el dibujo → menú **⋮ (arriba a la derecha del dibujo) → Asignar secuencia
   de comandos**.
3. Escribe el **nombre de la función** (sin paréntesis) según esta tabla:

| Botón | Función a asignar |
|---|---|
| Arrastres | `procesarArrastres` |
| Marcar pedidos a retener | `procesarRecepcion` |
| Meco (formato) | `procesarMecoMenu` |
| Vaciar retenidos | `vaciarRetenidosMenu` |
| Enviar a Málaga | `enviarMalagaMenu` |
| Enviar a Marbella | `enviarMarbellaMenu` |
| Enviar a Mijas | `enviarMijasMenu` |
| Imprimir pedidos Pyxis arrastres | `imprimirPedidosPyxisArrastres` |
| Imprimir pedidos Pyxis recepción | `imprimirPedidosPyxisRecepcion` |
| Imprimir hoja TOP | `imprimirTOP` |
| Crear TraMeco | `copiarFlujosConsolidado` |
| Borrar todo el contenido | `borrarTodoMenu` |
| Abrir panel (añadir/quitar) | `abrirPanel` |
| Enviar sugerencia o fallo | `abrirSugerencias` |

> **Añadir / quitar retenidos** usa formularios, así que se hace desde el **panel**
> (botón "Abrir panel"). El resto funciona como botón en la hoja.

## Palanca de velocidad
En `Config.gs`, `AUTOAJUSTAR_COLUMNAS` está en `false` (máxima velocidad). Ponlo en `true`
si prefieres que las columnas se ajusten solas (más lento en hojas grandes).
