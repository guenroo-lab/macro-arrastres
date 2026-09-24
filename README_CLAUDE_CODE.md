# Pasar este proyecto a Claude Code

Guía para abrir y trabajar este proyecto (Google Apps Script ligado a una Sheet) desde Claude Code.

## 1. Qué hay en la carpeta

Todos los `.gs`, `Panel.html`, `appsscript.json`, más:
- **`CLAUDE.md`** → memoria del proyecto. Claude Code lo lee solo al entrar. Mantenlo actualizado.
- **`LEEME.md`** → documentación funcional para el usuario.

## 2. Instalar Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```
Luego, dentro de la carpeta del proyecto:
```bash
cd ruta/al/proyecto
claude
```
Claude Code detectará `CLAUDE.md` automáticamente.

## 3. Conectar con Google Apps Script (clasp)

El proyecto es un **script contenedor** (ligado a la Google Sheet). Para subir/bajar el código se usa
**clasp** (Command Line Apps Script).

```bash
# instalar clasp
npm install -g @google/clasp

# iniciar sesión con la cuenta de Google que tiene acceso a la Sheet
clasp login
```

### Obtener el Script ID
1. Abre la Google Sheet → **Extensiones → Apps Script**.
2. En el editor: **Configuración del proyecto (engranaje) → ID de secuencia de comandos**. Copia ese ID.

### Crear `.clasp.json`
En la raíz de la carpeta, crea `.clasp.json` (NO lo subas a repos públicos):
```json
{
  "scriptId": "PEGA_AQUI_EL_SCRIPT_ID",
  "rootDir": "."
}
```

### Activar la API de Apps Script
Una vez (por cuenta): https://script.google.com/home/usersettings → activar "API de Apps Script".

## 4. Flujo de trabajo

```bash
# bajar lo que haya en el editor de Apps Script a local
clasp pull

# ... editar archivos con Claude Code ...

# subir los cambios al editor de Apps Script
clasp push
```

> `clasp push` sube **todos** los archivos de la carpeta. Para que el manifiesto se respete, mantén
> `appsscript.json`. Tras `clasp push`, recarga la Sheet para ver el menú/panel actualizados.

## 5. Reglas del proyecto (resumen, ver `CLAUDE.md`)

- Responder en español, directo.
- Entregar archivos completos, nunca fragmentos.
- Validar sintaxis de cada `.gs` tras editar.
- "Borrar todo" NO toca RETENIDOS.
- SSCC y pedidos siempre como texto.
- Impresión TOP: ancho natural + escala JS (no `table-layout:fixed`).

## 6. Aviso

clasp empareja por **nombre de archivo**. Como aquí los `.gs` están en la raíz (sin subcarpetas), encajan
directamente con el proyecto de Apps Script. Si en el editor online tienes los archivos con los mismos
nombres, `clasp push` los reemplaza.
