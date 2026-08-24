import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { configuracionIndusther } from "@/lib/servicios/industher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Explorador TEMPORAL del API de Industher: prueba una batería de rutas con
 * la llave real y reporta cuáles contestan y con qué forma (solo los nombres
 * de campos y un renglón de muestra, nunca la llave). Sirve para encontrar
 * la ruta exacta de los envíos pendientes. Borrable después.
 */
const CANDIDATAS = [
  "/api/integracion/envios-pendientes",
  "/api/integracion/envios",
  "/api/integracion/salidas",
  "/api/integracion/pendientes",
  "/api/integracion/apartados",
  "/api/integracion",
  "/api/envios-pendientes",
  "/api/envios",
  "/api/salidas",
  "/api/pendientes",
  "/api/integracion/inventario?limit=2",
];

export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const config = configuracionIndusther();
  if (!config) return NextResponse.json({ error: "Falta INDUSTHER_API_KEY." }, { status: 400 });

  const origen = new URL(config.url).origin;
  const resultados: Record<string, unknown>[] = [];

  // La radiografía del bloque pendingShipments: llaves del bloque, del
  // primer envío y de su primer producto, con UN envío completo de muestra
  // (products recortado a 2). Es lo que hace falta para amarrar los campos
  // exactos sin adivinar.
  let pendientes: unknown = null;
  try {
    const url = new URL(config.url);
    url.searchParams.set("limit", "1");
    url.searchParams.set("offset", "0");
    const r = await fetch(url, {
      headers: { "x-api-key": config.apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const cuerpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    const bloque = cuerpo?.pendingShipments as Record<string, unknown> | undefined;
    if (!bloque) {
      pendientes = { aviso: "la respuesta no trae pendingShipments", llavesRespuesta: cuerpo ? Object.keys(cuerpo) : null };
    } else {
      const envios = Object.values(bloque).find(Array.isArray) as Record<string, unknown>[] | undefined;
      const primero = envios?.[0] ?? null;
      let muestra: unknown = primero;
      let llavesProducto: string[] | null = null;
      if (primero && typeof primero === "object") {
        const copia: Record<string, unknown> = { ...primero };
        for (const [k, v] of Object.entries(copia)) {
          if (Array.isArray(v)) {
            llavesProducto = v[0] && typeof v[0] === "object" ? Object.keys(v[0]) : null;
            copia[k] = v.slice(0, 2);
          }
        }
        muestra = copia;
      }
      pendientes = {
        llavesBloque: Object.keys(bloque),
        totalEnvios: envios?.length ?? 0,
        llavesEnvio: primero && typeof primero === "object" ? Object.keys(primero) : null,
        llavesProducto,
        muestra,
      };
    }
  } catch (err) {
    pendientes = { error: (err as Error).message.slice(0, 200) };
  }

  for (const ruta of CANDIDATAS) {
    const url = `${origen}${ruta}`;
    try {
      const r = await fetch(url, {
        headers: { "x-api-key": config.apiKey, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const texto = await r.text();
      let cuerpo: unknown = null;
      try {
        cuerpo = texto ? JSON.parse(texto) : null;
      } catch {
        resultados.push({ ruta, status: r.status, forma: "no-json", inicio: texto.slice(0, 120) });
        continue;
      }

      // Solo la FORMA: llaves del objeto y del primer elemento de la primera
      // lista que aparezca, más un renglón de muestra.
      const resumen: Record<string, unknown> = { ruta, status: r.status };
      if (Array.isArray(cuerpo)) {
        resumen.forma = `lista de ${cuerpo.length}`;
        resumen.camposPrimero = cuerpo[0] && typeof cuerpo[0] === "object" ? Object.keys(cuerpo[0]) : null;
        resumen.muestra = cuerpo[0] ?? null;
      } else if (cuerpo && typeof cuerpo === "object") {
        const llaves = Object.keys(cuerpo);
        resumen.forma = "objeto";
        resumen.llaves = llaves;
        for (const k of llaves) {
          const v = (cuerpo as Record<string, unknown>)[k];
          if (Array.isArray(v)) {
            resumen.listaEn = k;
            resumen.largo = v.length;
            resumen.camposPrimero = v[0] && typeof v[0] === "object" ? Object.keys(v[0]) : null;
            resumen.muestra = v[0] ?? null;
            break;
          }
        }
      } else {
        resumen.forma = String(cuerpo);
      }
      resultados.push(resumen);
    } catch (err) {
      resultados.push({ ruta, error: (err as Error).message.slice(0, 120) });
    }
  }

  return NextResponse.json({ origen, pendientes, resultados });
}
