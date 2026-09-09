/**
 * Correo saliente (Resend, por HTTP; sin dependencias).
 *
 * Variables de entorno:
 *   RESEND_API_KEY     llave de Resend (sin ella no se manda nada y se declara)
 *   CORREO_REMITENTE   "ERP GETAC <avisos@tudominio>" (con Resend sin dominio
 *                      verificado solo sirve onboarding@resend.dev y solo
 *                      llega al correo dueño de la cuenta de Resend)
 *   CORREO_AVISOS      a quién se le mandan los avisos del ERP
 */

export interface Correo {
  para?: string;
  asunto: string;
  html: string;
  texto?: string;
}

export interface ResultadoCorreo {
  enviado: boolean;
  id?: string;
  motivo?: string;
}

export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && destinatarioAvisos());
}

export function destinatarioAvisos(): string | null {
  return process.env.CORREO_AVISOS?.trim() || null;
}

export async function enviarCorreo(c: Correo): Promise<ResultadoCorreo> {
  const llave = process.env.RESEND_API_KEY;
  const para = c.para ?? destinatarioAvisos();
  if (!llave) return { enviado: false, motivo: "Falta RESEND_API_KEY en el entorno." };
  if (!para) return { enviado: false, motivo: "Falta CORREO_AVISOS en el entorno." };
  const from = process.env.CORREO_REMITENTE?.trim() || "ERP GETAC <onboarding@resend.dev>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [para], subject: c.asunto, html: c.html, text: c.texto }),
    signal: AbortSignal.timeout(15_000),
  });
  const cuerpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!r.ok) {
    return { enviado: false, motivo: `Resend ${r.status}: ${cuerpo.message ?? cuerpo.name ?? "sin detalle"}` };
  }
  return { enviado: true, id: cuerpo.id };
}
