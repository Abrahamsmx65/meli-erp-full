import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { avanceDeCortes, pendientesDeCorte, pendientesPorModeloDeCuenta } from "@/lib/servicios/tiktok-despacho";
import { DespachoTikTok, type CorteResumen } from "@/components/despacho-tiktok";
import { EnlacePreparar } from "@/components/enlace-preparar";
import { tokenPreparar } from "@/lib/servicios/acceso-preparar";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** Despacho de TikTok por cortes: confirmar todo, etiquetas y lista de empaque. */
export default async function Despacho() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Despacho de pedidos" />;

  // Los pendientes se leen UNA vez (el selector por modelo los reusa) y el
  // avance sale SOLO de los cortes que se enseñan: antes se bajaba el
  // historial completo de preparaciones y de pedidos cortados.
  // Promise.resolve: el builder de Supabase vuelve a consultar cada vez que
  // se le pide `then`; así la consulta sale una sola vez para los dos usos.
  const cortesP = Promise.resolve(
    supabase
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares, handover, errores, modelos")
      .eq("account_id", cuenta.id)
      .order("numero", { ascending: false })
      .limit(30),
  );
  const pendientesP = pendientesDeCorte(supabase, cuenta.id);
  const [pendientes, cortesResultado, token, porModelo, avance] = await Promise.all([
    pendientesP,
    cortesP,
    tokenPreparar(cuenta.id),
    // Corte por modelo: cuántos pendientes son de un solo modelo, por modelo.
    pendientesP
      .then((p) => pendientesPorModeloDeCuenta(supabase, cuenta.id, p))
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
    preparados: avance === null ? null : (avance.get(Number(c.id))?.preparados ?? 0),
    cancelados: avance?.get(Number(c.id))?.cancelados ?? 0,
    enviados: avance?.get(Number(c.id))?.enviados ?? 0,
  }));

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Despacho de pedidos"
        descripcion="Un corte confirma lo pendiente y deja listas las etiquetas y la lista de empaque."
        ayuda={
          <p>
            La rutina de la mañana: el corte ordena primero lo de un solo modelo (y dentro, primero lo de un solo color) y al
            final lo revuelto.
          </p>
        }
        ayudaTitulo="¿Cómo se ordena el corte?"
      />
      {sinAvance ? (
        <Aviso tono="alerta">
          No se pudo leer el avance de preparación (los «X / Y preparados» salen con —). Los cortes y el despacho siguen
          funcionando; recarga la página para reintentar.
        </Aviso>
      ) : null}
      <DespachoTikTok pendientes={pendientes.length} cortes={cortes} porModelo={porModelo} />
      <EnlacePreparar tokenInicial={token} origen={origen} />
    </Pagina>
  );
}
