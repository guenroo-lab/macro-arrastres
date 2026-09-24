/**
 * PANEL ARRASTRES — WEB APP
 * Mismo trabajo diario que Panel.html (sidebar), pero accesible sin abrir el
 * Sheet: Session.getActiveUser().getEmail() sigue identificando a quien entra
 * (mismo dominio) porque el deploy es executeAs: USER_DEPLOYING + access:
 * DOMAIN (ver appsscript.json) — no hace falta compartir el Sheet con nadie.
 *
 * Solo lleva las 4 secciones de trabajo diario (cajones, retenidos, envío de
 * correos, impresiones sueltas — spec 2026-09-07-arrastres-web-y-hodos-design.md
 * §5.E). Cachés, celdas del libro, automatizaciones, borrar contenido y
 * sugerencias son admin: se quedan solo en Panel.html (sidebar, Sheet abierto).
 */
function doGet() {
  // Plantilla (no HTML plano): Web.html usa <?= CFG.LOGO_TAISA_B64 ?> para
  // pintar el logo de Taisa con el MISMO base64 que ya usa la carátula de
  // impresión (Impresion.gs/_caratulaFragmento_), sin duplicar el dato, y
  // <?= hodosUrl ?> para la pestaña HODOS (mismo enlace que ya usa Meco en
  // MECO_HODOS_WEBAPP_URL, MecoConfig.gs — google.script.run NO puede llamar
  // a otro proyecto de Apps Script, así que esa pestaña embebe la app HODOS
  // real en un iframe en vez de reimplementar su lógica aquí).
  const tmpl = HtmlService.createTemplateFromFile('Web');
  tmpl.hodosUrl = MECO_HODOS_WEBAPP_URL;
  return tmpl.evaluate()
    .setTitle('Panel Arrastres')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
