/**
 * CONFIGURACIÓN CENTRAL — Macro Arrastres (v2 optimizada)
 * Migración VBA -> Google Apps Script
 */
const CFG = {
  HOJAS: {
    TOP: 'TOP',
    // TOM ya NO es una hoja: se lee directo desde Drive (TOMDrive.gs).
    // Si la hoja "TOM" sigue en el libro, ya no se usa — se puede borrar.
    EAN: 'EAN',
    RETENIDOS: 'RETENIDOS',
    TRAMECO: 'TRAMECO',           // entrada: pega aquí, HODOS lee de aquí directamente
    FAMILIAS: 'FAMILIAS TIENDA',
    HISTORICO: 'HISTORICO',
    CERAMICA: 'CERAMICA',        // catálogo de LM de cerámica (Sección 6 filtrada)
    HODOS: 'HODOS'               // salida: pedidos sin trazabilidad, por tienda
  },

  COLORES: {
    VERDE_OSCURO: '#6aa84f',
    VERDE_CLARO: '#d9ead3',
    MORADO: '#b4a7d6',
    BLANCO: '#ffffff',
    GRIS_CABECERA: '#dcdcdc',
    GRIS_OSCURO: '#808080',
    GRIS_TITULO: '#d9d9d9',
    GRIS_FLUJOS: '#bfbfbf',
    AZUL_CLARO: '#bdd7ee',
    AMARILLO: '#ffe599',
    LILA_CLARO: '#ccc0da',
    MORADO_TITULO: '#4a235a'
  },

  // ===== RENDIMIENTO =====
  // El autoajuste de columnas es la operación más lenta de Sheets.
  // Déjalo en false para máxima velocidad; ponlo en true si prefieres que
  // las columnas se ajusten solas (más lento en hojas grandes).
  AUTOAJUSTAR_COLUMNAS: false,

  // ID de carpeta de Drive para los PDF. Vacío = raíz de Mi unidad.
  CARPETA_PDF: '',

  // Códigos LM excluidos (proceso Meco)
  COD_EXCLUIDOS: ['49516663', '49516656'],
  // LM siempre válido aunque transporte = no (proceso Recepción)
  LM_SIEMPRE_VALIDO: '49009538',

  // ===== REGISTRO ÚNICO DE RETENIDOS =====
  // Un solo bloque por tienda, se va acumulando durante el día.
  // 9 columnas de datos + 1 de separación = 10 por bloque.
  // 'Flete' (col B de TOP) solo en arrastres (Torija/Valencia/Antequera); resto en blanco.
  // 'Expedición' la rellenas tú a mano; 'Enviado' lo sella el envío.
  // 'Día' = fecha de salida a tienda, se calcula sola según el origen.
  RETEN_COLS: ['Tipo', 'Flete', 'Pedido', 'Pyxis', 'Agrupación', 'SSCC', 'Expedición', 'Enviado', 'Día'],
  // Granada vuelve a retenerse (pedido 2026-09-09, direcciones de correo
  // añadidas el mismo día en TIENDAS_ENVIO): de momento SOLO el registro de
  // retenidos y su envío (añadir/ver/quitar/mover fecha/enviar). NO está en
  // TIENDA_ARRASTRE ni TIENDA_RECEPCION — no hay código de tienda conocido
  // todavía para detectarla sola desde arrastres/recepción.
  RETEN_BLOQUES: [
    { nombre: 'Málaga',   color: '#c6e0b4', col: 1 },
    { nombre: 'Marbella', color: '#bdd7ee', col: 11 },
    { nombre: 'Mijas',    color: '#ccc0da', col: 21 },
    { nombre: 'Granada',  color: '#f4cccc', col: 31 }
  ],

  // ===== DÍA DE ENVÍO AUTOMÁTICO POR ORIGEN =====
  // Días a sumar a HOY según el "Tipo" (origen) del retenido:
  //   0 = sale hoy mismo · 1 = sale mañana
  // Si el resultado cae en sábado o domingo, se pasa al lunes (_fechaEnvioPorOrigen_).
  // Lo que no esté aquí (p. ej. "Manual") sale hoy por defecto.
  DIA_POR_ORIGEN: {
    'Valencia': 1,
    'Torija': 1,
    'Meco': 1,
    'Antequera': 0,
    'Recepción': 0,
    'Recepción de Portada': 0
  },

  // Mapas de tienda -> nombre canónico del bloque de retenidos
  // (Granada ya no se retiene)
  TIENDA_ARRASTRE: { 'MALAGA': 'Málaga', 'MARBELLA': 'Marbella', 'MIJAS': 'Mijas' },
  TIENDA_RECEPCION: { '036': 'Málaga', '014': 'Marbella', '279': 'Mijas' },

  // Origen de los arrastres (columna A). Este nombre es el que aparece en la
  // columna "Tipo" de RETENIDOS. Añade aquí el código de Antequera cuando lo
  // tengas (p. ej. 'E4XX': 'Antequera').
  ORIGENES: {
    'E431': 'Torija',
    'E439': 'Valencia',
    'E448': 'Meco',
    '448': 'Meco'
  },

  // ===== ENVÍO DE RETENIDOS POR CORREO =====
  // Remitente fijo. Debe estar dado de alta como "Enviar como" en tu Gmail;
  // si no lo está, el correo sale desde tu cuenta y se te avisa.
  REMITENTE: 'administracion.alm-malaga@leroymerlin.es',
  REMITENTE_NOMBRE: 'Administración Almacén Málaga',

  // ===== CARÁTULA DE DESCARGA (Impresion.gs) =====
  // Logo Taisa Logistics en base64 (evita depender de una URL externa al imprimir).
  LOGO_TAISA_B64: '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',

  // ===== SUGERENCIAS / MEJORAS / FALLOS =====
  // Botón para que el personal o jefes de equipo manden sugerencias, mejoras o
  // fallos (con foto/recorte opcional). Llegan por correo a SUGERENCIAS_PARA.
  // Módulo reutilizable: copia Sugerencias.gs + SugerenciasForm.html a otras apps y
  // ajusta estas dos claves.
  APP_NOMBRE: 'Macro Arrastres',
  SUGERENCIAS_PARA: ['pedro.gil@ext.leroymerlin.es'],

  // Destinatarios del informe GLOBAL (plataforma).
  INFORMES_PARA: [
    'jose-manuel.lachambre@leroymerlin.es',
    'pedro.gil@ext.leroymerlin.es',
    'david.delcampo@ext.leroymerlin.es',
    'jose-antonio.alcaide@ext.leroymerlin.es'
  ],

  // CC fijo en todos los informes de tienda (los mismos 4 del global).
  INFORMES_CC: [
    'jose-manuel.lachambre@leroymerlin.es',
    'pedro.gil@ext.leroymerlin.es',
    'david.delcampo@ext.leroymerlin.es',
    'jose-antonio.alcaide@ext.leroymerlin.es'
  ],

  // Destinatarios del informe POR TIENDA.
  // Málaga: pendiente de destinatarios (se deja vacío, no se envía hasta que se rellene).
  INFORMES_TIENDA: {
    'Málaga': [],
    'Marbella': [
      'francisco-damian.sedeno@leroymerlin.es',
      'miguel-angel.gonzalez5@leroymerlin.es',
      'logistica.marbella@leroymerlin.es',
      'david.jimenez2@leroymerlin.es',
      'francisco-manuel.cano@leroymerlin.es',
      'daniel-juan.rodriguez@leroymerlin.es',
      'felix.leiva@leroymerlin.es',
      'antonio.chaparro@leroymerlin.es',
      'francisco-javier.cabrera@leroymerlin.es',
      'juan-carlos.fernandez@leroymerlin.es',
      'juan-vicente.clavijo@leroymerlin.es',
      'manuel.ortega@leroymerlin.es',
      'maria-josefa.hernandez@leroymerlin.es',
      'marina.acosta@leroymerlin.es',
      'miguel-daniel.morales@leroymerlin.es',
      'jose-maria.marandino@leroymerlin.es',
      'comitedireccion.marbella@leroymerlin.es'
    ],
    'Mijas': [
      'hector.andres@leroymerlin.es',
      'salvador.gonzalez2@leroymerlin.es',
      'carlos.fuentes@leroymerlin.es',
      'logistica.mijas@leroymerlin.es',
      'david.jimenez2@leroymerlin.es',
      'comitedireccion.mijas@leroymerlin.es'
    ]
  },

  // Copia fija en todos los envíos
  CC_FIJO: [
    'francisco-javier.camara@ext.leroymerlin.es',
    'daniel.arrastio@ext.leroymerlin.es',
    'david.delcampo@ext.leroymerlin.es',
    'sebastian.gelvis@ext.leroymerlin.es',
    'pedro.gil@ext.leroymerlin.es',
    'pedidocliente.alm-malaga@leroymerlin.es',
    'jose-manuel.lachambre@leroymerlin.es',
    'jose-antonio.alcaide@ext.leroymerlin.es',
    'administracion.alm-malaga@leroymerlin.es'
  ],

  // Destinatarios (TO) por tienda
  TIENDAS_ENVIO: {
    'Málaga': [
      'pedcliente.malaga@leroymerlin.es',
      'recepcion.malaga@leroymerlin.es',
      'logistica.malaga@leroymerlin.es'
    ],
    'Marbella': [
      'pedcliente.marbella@leroymerlin.es',
      'logistica.marbella@leroymerlin.es',
      'recepcion.marbella@leroymerlin.es'
    ],
    'Mijas': [
      'pedcliente.mijas@leroymerlin.es',
      'recepcion.mijas@leroymerlin.es',
      'logistica.mijas@leroymerlin.es'
    ],
    'Granada': [
      'recepcion.granada@leroymerlin.es',
      'pedcliente.granada@leroymerlin.es',
      'logistica.granada@leroymerlin.es'
    ]
  },

  // ===== IMPORTAR RETENIDOS DE PORTADA =====
  // Programa de Retenciones de Recepción (portada). Esta macro LEE su hoja y
  // añade los retenidos del día a la lista unificada. Tiendas: Marbella y Mijas.
  PORTADA_SHEET_ID: '16fdPWFSGzBQCGgK9sN3SA3pVGT5uJNnoTGKq8j1lcKg',
  PORTADA_TAB: 'Retenidos',

  // ===== BORRAR CONTENIDO =====
  RESET_TOTAL: ['TOP'],           // se borran contenido + formato
  RESET_CONTENIDO: ['TRAMECO'],   // solo contenido (conserva cabeceras). TOM ya no es hoja (Drive).
  // RETENIDOS se vacía/limpia aparte.
  // NO se tocan EAN ni FAMILIAS TIENDA (datos maestros).
};
