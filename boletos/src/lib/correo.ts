/**
 * Correo saliente. Dos caminos, se usa el que esté configurado:
 *
 * 1. SMTP (`SMTP_USUARIO` + `SMTP_CLAVE`): tu propio Gmail con "contraseña de
 *    aplicación". Para uso personal es lo más simple: no necesita dominio.
 *    Gmail permite ~500 correos al día, de sobra para un evento.
 * 2. Resend (`RESEND_API_KEY`): servicio con dominio propio verificado.
 *
 * Si no hay ninguno, no truena: se registra en consola y el pedido sigue su
 * curso; el boleto siempre se puede ver en su página.
 */
import nodemailer from "nodemailer";
import { leerConfig } from "./config";

export interface Adjunto {
  filename: string;
  content: Buffer;
}

export interface Correo {
  para: string;
  asunto: string;
  html: string;
  adjuntos?: Adjunto[];
  copia?: string;
}

export interface ResultadoCorreo {
  enviado: boolean;
  error?: string;
}

type Cfg = Awaited<ReturnType<typeof leerConfig>>;

export async function enviarCorreo(c: Correo): Promise<ResultadoCorreo> {
  const cfg = await leerConfig();
  const copia = c.copia ?? cfg.CORREO_ORGANIZADOR;
  if (cfg.SMTP_USUARIO && cfg.SMTP_CLAVE) return enviarPorSmtp({ ...c, copia }, cfg);
  if (cfg.RESEND_API_KEY) return enviarPorResend({ ...c, copia }, cfg);
  console.warn(`[correo] Sin SMTP ni Resend configurados; no se envió "${c.asunto}" a ${c.para}`);
  return { enviado: false, error: "Correo no configurado" };
}

async function enviarPorSmtp(c: Correo, cfg: Cfg): Promise<ResultadoCorreo> {
  const usuario = cfg.SMTP_USUARIO!;
  const puerto = cfg.SMTP_PUERTO ?? "465";
  const transporte = nodemailer.createTransport({
    host: cfg.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(puerto),
    secure: puerto === "465",
    auth: { user: usuario, pass: cfg.SMTP_CLAVE! },
  });
  try {
    await transporte.sendMail({
      from: cfg.CORREO_REMITENTE || usuario,
      to: c.para,
      bcc: c.copia || undefined,
      subject: c.asunto,
      html: c.html,
      attachments: c.adjuntos?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    return { enviado: true };
  } catch (e) {
    console.error("[correo] SMTP no pudo enviar:", e);
    return { enviado: false, error: String(e) };
  }
}

async function enviarPorResend(c: Correo, cfg: Cfg): Promise<ResultadoCorreo> {
  const key = cfg.RESEND_API_KEY!;
  const remitente = cfg.CORREO_REMITENTE;
  if (!remitente) return { enviado: false, error: "Falta CORREO_REMITENTE" };

  const cuerpo: Record<string, unknown> = {
    from: remitente,
    to: [c.para],
    subject: c.asunto,
    html: c.html,
  };
  if (c.copia) cuerpo.bcc = [c.copia];
  if (c.adjuntos?.length) {
    cuerpo.attachments = c.adjuntos.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    }));
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) {
      const texto = await r.text();
      console.error(`[correo] Resend contestó ${r.status}: ${texto}`);
      return { enviado: false, error: `Resend ${r.status}` };
    }
    return { enviado: true };
  } catch (e) {
    console.error("[correo] No se pudo enviar:", e);
    return { enviado: false, error: String(e) };
  }
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}

/** Plantilla base: sencilla, se ve bien en cualquier cliente de correo. */
export function plantilla(titulo: string, contenidoHtml: string): string {
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2a30">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:14px;padding:28px 24px;border:1px solid #e6e0d2">
    <h1 style="margin:0 0 16px;font-size:22px">${escapar(titulo)}</h1>
    ${contenidoHtml}
  </div>
  <p style="text-align:center;color:#7a8589;font-size:12px;margin-top:16px">Este correo se generó automáticamente.</p>
</div>
</body></html>`;
}

export { escapar };
