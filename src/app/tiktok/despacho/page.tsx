import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { pendientesDeCorte } from "@/lib/servicios/tiktok-despacho";
import { DespachoTikTok, type CorteResumen } from "@/components/despacho-tiktok";
import { EnlacePreparar } from "@/components/enlace-preparar";
import { tokenPreparar } from "@/lib/servicios/acceso-preparar";

export const dynamic = "force-dynamic";

/** Despacho de TikTok por cortes: confirmar todo, etiquetas y lista de empaque. */
export default async function Despacho() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }

  const [pendientes, { data: cortesRaw }, { data: prepRaw }, token] = await Promise.all([
    pendientesDeCorte(supabase, cuenta.id),
    supabase
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares, handover, errores")
      .eq("account_id", cuenta.id)
      .order("numero", { ascending: false })
      .limit(30),
    supabase.from("tiktok_preparaciones").select("corte_id").eq("account_id", cuenta.id),
    tokenPreparar(cuenta.id),
  ]);
  // El link de los empleados va SIEMPRE al dominio de producción que Vercel
  // reporta (VERCEL_PROJECT_PRODUCTION_URL), no a lo que diga la variable
  // de la app: los otros dominios del proyecto (git-main, getac) están
  // detrás de la autenticación de Vercel y ahí el link pediría contraseña.
  // Sin diagonal final: con ella salía "//preparar/…" y rebotaba al login.
  const dominioVercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  const origen = (
    dominioVercel ? `https://${dominioVercel}` : (process.env.NEXT_PUBLIC_APP_URL ?? "https://meli-erp-full.vercel.app")
  ).replace(/\/+$/, "");
  const preparadosPorCorte = new Map<number, number>();
  for (const r of prepRaw ?? []) {
    preparadosPorCorte.set(r.corte_id, (preparadosPorCorte.get(r.corte_id) ?? 0) + 1);
  }

  const cortes: CorteResumen[] = (cortesRaw ?? []).map((c: any) => ({
    id: c.id,
    numero: c.numero,
    creadoEn: c.creado_en,
    pedidos: c.pedidos,
    pares: c.pares,
    handover: c.handover,
    errores: c.errores ?? [],
    preparados: preparadosPorCorte.get(c.id) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Despacho TikTok Shop</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          La rutina de la mañana: un corte confirma todo lo pendiente y deja listas las etiquetas y
          la lista de empaque, en orden de modelo.
        </p>
      </div>
      <DespachoTikTok pendientes={pendientes.length} cortes={cortes} />
      <EnlacePreparar tokenInicial={token} origen={origen} />
    </div>
  );
}
