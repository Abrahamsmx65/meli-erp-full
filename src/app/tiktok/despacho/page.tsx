import { clienteServidor } from "@/lib/supabase/server";
import { contarMuestras } from "@/lib/tiktok/corte-modelos";
import { cuentaActiva } from "@/lib/datos/repos";
import { avanceDeCortes, pendientesDeCorte, tiemposDeCortes, pendientesPorModeloDeCuenta } from "@/lib/servicios/tiktok-despacho";
import { DespachoTikTok, type CorteResumen } from "@/components/despacho-tiktok";
import { EnlacePreparar } from "@/components/enlace-preparar";
import { tokenPreparar } from "@/lib/servicios/acceso-preparar";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import Link from "next/link";
import { nombreDeVendedor, normalizarVendedor, VENDEDOR_DAVID } from "@/lib/tiktok/externos";

export const dynamic = "force-dynamic";

/**
 * Despacho de TikTok por cortes: confirmar todo, etiquetas y lista de empaque.
 * `?vendedor=david` enseña los cortes y pendientes del vendedor externo
 * (David despacha desde su bodega): sus pedidos nunca entran al corte del
 * dueño ni al revés.
 */
export default async function Despacho({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Despacho de pedidos" />;
  const params = await searchParams;
  const vendedor = normalizarVendedor(params?.vendedor);

  // Los pendientes se leen UNA vez (el selector por modelo los reusa) y el
  // avance sale SOLO de los cortes que se enseñan: antes se bajaba el
  // historial completo de preparaciones y de pedidos cortados.
  // Promise.resolve: el builder de Supabase vuelve a consultar cada vez que
  // se le pide `then`; así la consulta sale una sola vez para los dos usos.
  const consultaCortes = supabase
    .from("tiktok_cortes")
    .select("id, numero, creado_en, pedidos, pares, handover, errores, modelos, vendedor, muestras")
    .eq("account_id", cuenta.id);
  const cortesP = Promise.resolve(
    (vendedor ? consultaCortes.eq("vendedor", vendedor) : consultaCortes.is("vendedor", null))
      .order("numero", { ascending: false })
      .limit(30),
  );
  const pendientesP = pendientesDeCorte(supabase, cuenta.id, vendedor);
  const [pendientes, cortesResultado, token, porModelo, avance, tiempos, deLosOtros] = await Promise.all([
    pendientesP,
    cortesP,
    tokenPreparar(cuenta.id),
    // Corte por modelo: cuántos pendientes son de un solo modelo, por modelo.
    pendientesP
      .then((p) => pendientesPorModeloDeCuenta(supabase, cuenta.id, p, vendedor))
      .catch(() => ({ modelos: [], revueltos: { pedidos: 0, pares: 0 }, sinSku: 0 })),
    // Preparados, cancelados DESPUÉS de entrar al corte (conservan su número
    // en la hoja) y los que TikTok ya tiene en camino o entregados (se fueron
    // con el repartidor; con solo la guía creada, AWAITING_COLLECTION, no).
    // Si la lectura falla, el avance se DECLARA no disponible (null) en vez
    // de pintar ceros como si fueran dato: los cortes y el despacho siguen.
    cortesP
      .then((r) => avanceDeCortes(supabase, cuenta.id, (r.data ?? []).map((c: any) => Number(c.id))))
      .catch((err: Error): null => {
        console.error("avance de los cortes de TikTok:", err.message);
        return null;
      }),
    // Cuánto tardó la preparación de cada corte (primera y última constancia).
    cortesP
      .then((r) => tiemposDeCortes(supabase, cuenta.id, (r.data ?? []).map((c: any) => Number(c.id))))
      .catch(() => new Map<number, { primera: string; ultima: string }>()),
    // Cuántos pendientes tiene el OTRO despacho (el dueño ↔ David), para el enlace de arriba.
    pendientesDeCorte(supabase, cuenta.id, vendedor ? null : VENDEDOR_DAVID)
      .then((p) => p.length)
      .catch(() => 0),
  ]);
  if (cortesResultado.error) {
    throw new Error(`No se pudieron leer los cortes de TikTok: ${cortesResultado.error.message}`);
  }
  const cortesRaw = cortesResultado.data;
  // El link de los empleados va SIEMPRE al dominio de producción que Vercel
  // reporta (VERCEL_PROJECT_PRODUCTION_URL), no a lo que diga la variable
  // de la app: los otros dominios del proyecto (git-main, getac) están
  // detrás de la autenticación de Vercel y ahí el link pediría contraseña.
  // Sin diagonal final: con ella salía "//preparar/…" y rebotaba al login.
  const dominioVercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  const origen = (
    dominioVercel ? `https://${dominioVercel}` : (process.env.NEXT_PUBLIC_APP_URL ?? "https://meli-erp-full.vercel.app")
  ).replace(/\/+$/, "");
  const sinAvance = avance === null;

  const cortes: CorteResumen[] = (cortesRaw ?? []).map((c: any) => ({
    id: c.id,
    numero: c.numero,
    creadoEn: c.creado_en,
    pedidos: c.pedidos,
    pares: c.pares,
    handover: c.handover,
    errores: c.errores ?? [],
    modelos: c.modelos ?? null,
    muestras: c.muestras === true,
    preparados: avance === null ? null : (avance.get(Number(c.id))?.preparados ?? 0),
    cancelados: avance?.get(Number(c.id))?.cancelados ?? 0,
    enviados: avance?.get(Number(c.id))?.enviados ?? 0,
    primeraPrep: tiempos.get(Number(c.id))?.primera ?? null,
    ultimaPrep: tiempos.get(Number(c.id))?.ultima ?? null,
  }));

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo={vendedor ? `Despacho de ${nombreDeVendedor(vendedor)}` : "Despacho de pedidos"}
        descripcion={
          vendedor
            ? `Los pedidos con algún producto de ${nombreDeVendedor(vendedor)} (también los que traen algo de GETAC): los despacha él desde su bodega.`
            : undefined
        }
        acciones={
          <Link href={vendedor ? "/tiktok/despacho" : `/tiktok/despacho?vendedor=${VENDEDOR_DAVID}`} className="boton boton-borde boton-chico">
            {vendedor ? `Cortes de GETAC (${deLosOtros} pendientes)` : `Cortes de ${nombreDeVendedor(VENDEDOR_DAVID)} (${deLosOtros} pendientes)`}
          </Link>
        }
      />
      {sinAvance ? (
        <Aviso tono="alerta">
          No se pudo leer el avance de preparación. Recarga la página para reintentar.
        </Aviso>
      ) : null}
      <DespachoTikTok pendientes={pendientes.length} muestrasPendientes={contarMuestras(pendientes)} cortes={cortes} porModelo={porModelo} vendedor={vendedor} />
      <EnlacePreparar tokenInicial={token} origen={origen} />
    </Pagina>
  );
}
