import "server-only";
import { config } from "./config";

/** Resend por HTTP, como el ERP. Sin llave no se manda nada y se dice. */
export async function enviarCorreo(para: string, asunto: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const llave = config.resendKey();
  if (!llave) return { ok: false, error: "Falta RESEND_API_KEY." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.remitente(), to: [para], subject: asunto, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
