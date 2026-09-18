import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { enviarCorreo } from "@/lib/servicios/correo";
import { destinatarioFaltantes, registrarCorreo } from "@/lib/servicios/tiktok-faltantes-correo";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Diagnóstico de correo: manda UN correo de prueba y contesta tal cual lo
 * que dijo Resend. El 18-sep-2026 a david no le llegaba el correo de
 * faltantes y no había forma de ver por qué: un remitente sin dominio
 * verificado (onboarding@resend.dev) solo entrega al dueño de la cuenta de
 * Resend, y eso se ve aquí como un 403.
 *
 *   /api/tiktok/diagnostico/correo            → al destinatario de faltantes
 *   /api/tiktok/diagnostico/correo?para=x@y   → a quien se diga
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const para = req.nextUrl.searchParams.get("para")?.trim() || destinatarioFaltantes();
  const remitente = process.env.CORREO_REMITENTE?.trim() || "ERP GETAC <onboarding@resend.dev> (sin dominio verificado: solo llega al dueño de la cuenta de Resend)";
  const asunto = "Prueba de correo del ERP";
  const resultado = await enviarCorreo({
    para,
    asunto,
    html: `<p>Si lees esto, el ERP sí puede mandarte correos. Enviado el ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}.</p>`,
    texto: "Si lees esto, el ERP sí puede mandarte correos.",
  });
  await registrarCorreo(clienteAdmin(), cuenta.id, "correo-prueba", para, asunto, resultado);
  return NextResponse.json({ para, remitente, llaveConfigurada: Boolean(process.env.RESEND_API_KEY), resultado });
}
