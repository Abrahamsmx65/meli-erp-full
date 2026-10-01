import { after, NextResponse, type NextRequest } from "next/server";
import { aplicarPago } from "@/lib/pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Aviso de Mercado Pago (IPN / webhooks). No se confía en el cuerpo: solo
 * dice QUÉ pago leer, y el pago se lee de Mercado Pago con nuestra llave
 * (`aplicarPago`). Así un aviso falso no puede marcar nada como pagado.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const tipo = String(body?.type ?? body?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const id = String(body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (tipo.includes("payment") && /^\d+$/.test(id)) {
    after(async () => {
      await aplicarPago(id);
    });
  }
  return NextResponse.json({ ok: true });
}

export const GET = POST;
