import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerHoja } from "@/lib/importar/leer-hoja";
import { canonizar } from "@/lib/importar/sku";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function texto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return texto(o.result);
    if ("text" in o) return texto(o.text);
  }
  return String(v).trim();
}

function costoDe(v: unknown): number | null {
  const t = texto(v).replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Carga masiva de categorías y costos desde un Excel con columnas
 * CATEGORIA | MODELO | COSTO (el orden no importa y "COSTO TOTAL" también
 * vale). El costo es por MODELO, en MXN, igual para todos los colores.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  }

  const filas = await leerHoja(Buffer.from(await archivo.arrayBuffer()), {
    nombre: archivo.name,
  });

  // Encabezados: se buscan MODELO y COSTO en las primeras filas.
  let filaEnc = -1;
  let colModelo = -1;
  let colCosto = -1;
  let colCategoria = -1;
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const f = filas[i].map((c) => canonizar(c));
    const iModelo = f.findIndex((c) => c === "MODELO" || c === "MODEL");
    const iCosto = f.findIndex((c) => c.startsWith("COSTO") || c.startsWith("COST"));
    if (iModelo < 0 || iCosto < 0) continue;
    filaEnc = i;
    colModelo = iModelo;
    colCosto = iCosto;
    colCategoria = f.findIndex((c) => c.startsWith("CATEGORIA") || c.startsWith("CATEGORY"));
    break;
  }
  if (filaEnc < 0) {
    return NextResponse.json(
      { error: 'No encontré las columnas. Se esperan "MODELO" y "COSTO" (y opcional "CATEGORIA").' },
      { status: 400 },
    );
  }

  const ahora = new Date().toISOString();
  const filasUpsert: Record<string, unknown>[] = [];
  for (let i = filaEnc + 1; i < filas.length; i++) {
    const f = filas[i];
    const modelo = texto(f[colModelo]).toUpperCase();
    if (!modelo) continue;
    const costo = costoDe(f[colCosto]);
    const categoria = colCategoria >= 0 ? texto(f[colCategoria]).toUpperCase() || null : null;
    if (costo == null && !categoria) continue;
    filasUpsert.push({
      account_id: cuenta.id,
      modelo,
      color: "",
      categoria,
      costo_mxn: costo,
      actualizado_en: ahora,
    });
  }

  if (!filasUpsert.length) {
    return NextResponse.json(
      { error: "No encontré ningún renglón con modelo y costo." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("productos_config")
    .upsert(filasUpsert, { onConflict: "account_id,modelo,color" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cargados: filasUpsert.length });
}
