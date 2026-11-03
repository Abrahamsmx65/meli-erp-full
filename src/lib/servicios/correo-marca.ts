/**
 * El correo con la cara de la página (dueño, 9-oct-2026: «que el correo vaya
 * con formato, con la misma paleta y estilo que la página y con el logo»).
 *
 * Los clientes de correo no leen hojas de estilo ni variables de CSS: todo va
 * en línea y en tablas, con los mismos tonos que `globals.css` copiados aquí.
 * El logo va por URL absoluta al sitio (Gmail bloquea las imágenes en
 * `data:`); `/getac-logo.png` es público porque el middleware no toca los
 * `.png`. Las letras: Fraunces y DM Sans donde el cliente las cargue (Apple
 * Mail, iOS); en Gmail y Outlook caen a Georgia y Arial.
 */

export const URL_ERP = "https://meli-erp-full.vercel.app";
export const URL_LOGO = `${URL_ERP}/getac-logo.png`;

/** Los tonos de `globals.css` (marca GETAC). */
export const TONO = {
  plano: "#f6f2ec",
  tarjeta: "#ffffff",
  suave: "#faf7f2",
  borde: "#e9e1d6",
  tinta: "#2a2019",
  tinta2: "#5e5146",
  tenue: "#998a7b",
  marca: "#2b2119",
  acento: "#8b6640",
  acentoSuave: "#f5ede3",
  bien: "#00854a",
  mal: "#c4320a",
  alerta: "#8a5a00",
  alertaSuave: "#fdf6e7",
} as const;

export const LETRA_TEXTO = "'DM Sans', Arial, Helvetica, sans-serif";
export const LETRA_TITULO = "Fraunces, Georgia, 'Times New Roman', serif";

export function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Envuelve el cuerpo en la plantilla de la marca: franja café con el logo,
 * tarjeta blanca sobre el crema de la página y pie con el botón al ERP.
 */
export function plantillaCorreo(o: {
  /** texto que los clientes enseñan junto al asunto en la bandeja */
  preencabezado: string;
  ceja?: string;
  titulo: string;
  subtitulo?: string;
  cuerpo: string;
  boton?: { texto: string; url: string };
}): string {
  const e = escaparHtml;
  return (
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Fraunces:wght@600&display=swap" rel="stylesheet">` +
    // En celular (Gmail, Apple Mail e iOS respetan estas reglas): las cifras
    // se apilan y la tabla se compacta para que nada se salga de la pantalla.
    `<style>@media (max-width:540px){` +
    `.g-tarjeta{padding:18px 14px !important}` +
    `.g-franja{padding:16px 14px !important}` +
    `.g-cifra{display:block !important;width:auto !important;margin:0 0 8px !important}` +
    `.g-hueco{display:none !important}` +
    `.g-t td,.g-t th{padding:8px 5px !important;font-size:12px !important}` +
    `.g-t th{font-size:9px !important;letter-spacing:0 !important}` +
    `.g-nota{margin-left:0 !important}` +
    `h1{font-size:22px !important}` +
    `}</style>` +
    `<title>${e(o.titulo)}</title></head>` +
    `<body style="margin:0;padding:0;background:${TONO.plano};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${TONO.plano}">${e(o.preencabezado)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${TONO.plano};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;font-family:${LETRA_TEXTO};color:${TONO.tinta};">` +
    // franja de la marca
    `<tr><td class="g-franja" style="background:${TONO.marca};border-radius:10px 10px 0 0;padding:20px 28px;">` +
    `<img src="${URL_LOGO}" width="112" alt="GETAC" style="display:block;width:112px;height:auto;border:0;">` +
    `</td></tr>` +
    // tarjeta
    `<tr><td class="g-tarjeta" style="background:${TONO.tarjeta};border:1px solid ${TONO.borde};border-top:0;border-radius:0 0 10px 10px;padding:28px;">` +
    (o.ceja
      ? `<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${TONO.acento};font-weight:700;margin:0 0 6px;">${e(o.ceja)}</div>`
      : "") +
    `<h1 style="margin:0;font-family:${LETRA_TITULO};font-size:26px;line-height:1.25;font-weight:600;color:${TONO.tinta};">${e(o.titulo)}</h1>` +
    (o.subtitulo ? `<p style="margin:6px 0 0;font-size:14px;color:${TONO.tinta2};">${e(o.subtitulo)}</p>` : "") +
    `<div style="height:20px;line-height:20px;">&nbsp;</div>` +
    o.cuerpo +
    (o.boton
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>` +
        `<td style="background:${TONO.acento};border-radius:8px;">` +
        `<a href="${e(o.boton.url)}" style="display:inline-block;padding:11px 20px;font-family:${LETRA_TEXTO};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${e(o.boton.texto)}</a>` +
        `</td></tr></table>`
      : "") +
    `</td></tr>` +
    `<tr><td style="padding:16px 4px 0;font-size:11px;color:${TONO.tenue};text-align:center;">GETAC · ERP · <a href="${URL_ERP}" style="color:${TONO.tenue};">${URL_ERP.replace("https://", "")}</a></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
