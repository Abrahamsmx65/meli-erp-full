import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { credencialesHiggsfield } from "@/lib/higgsfield/client";
import {
  GeneradorVideo,
  BotonActualizar,
  BotonBorrar,
  type Publicacion,
} from "@/components/videos";

export const dynamic = "force-dynamic";

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  creado: { texto: "Creado", color: "var(--ink-muted)" },
  enviado: { texto: "En el horno", color: "var(--estado-alerta)" },
  en_progreso: { texto: "Generando…", color: "var(--estado-alerta)" },
  completado: { texto: "✓ Listo", color: "var(--exito-texto)" },
  fallido: { texto: "Falló", color: "var(--estado-critico)" },
  rechazado: { texto: "Rechazado", color: "var(--estado-critico)" },
};

export default async function Videos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return <p className="text-sm">Conecta tu cuenta de Mercado Libre en Ajustes.</p>;
  }

  const hayLlave = Boolean(credencialesHiggsfield());

  // Una entrada por publicación; los SKUs de sus tallas se juntan para que
  // la búsqueda también encuentre por SKU, no solo por título o MLM.
  // Paginado con traerTodo: Supabase corta en 1000 filas por petición y un
  // .limit(5000) suelto dejaba fuera a la mayoría de los ~10 mil SKUs.
  const filasSkus = await traerTodo<{
    sku: string | null;
    item_id: string;
    titulo: string | null;
    modelo: string | null;
    color: string | null;
  }>(supabase, "skus", "sku, item_id, titulo, modelo, color", (q) =>
    q.eq("account_id", cuenta.id).eq("activo", true).not("item_id", "is", null),
  );

  const porItem = new Map<string, Publicacion>();
  for (const f of filasSkus) {
    const id = f.item_id as string;
    let pub = porItem.get(id);
    if (!pub) {
      pub = {
        itemId: id,
        titulo: (f.titulo as string) || id,
        modelo: (f.modelo as string) ?? "",
        color: (f.color as string) ?? "",
        skus: [],
      };
      porItem.set(id, pub);
    }
    if (f.sku) pub.skus.push(f.sku as string);
  }
  // traerTodo pagina por id, así que el orden alfabético se pone aquí.
  const publicaciones = [...porItem.values()].sort((a, b) =>
    a.titulo.localeCompare(b.titulo, "es"),
  );

  const { data: videos } = await supabase
    .from("videos_producto")
    .select("*")
    .eq("account_id", cuenta.id)
    .order("creado_en", { ascending: false })
    .limit(200);

  const enCurso = (videos ?? []).filter((v) =>
    ["enviado", "en_progreso"].includes(v.estado as string),
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Videos de producto</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Clips verticales 9:16 de 10 segundos listos para los Clips de Mercado
          Libre, generados directo de tus fotos reales: el producto sale tal cual,
          sin que la IA lo altere. El video terminado se guarda aquí para siempre;
          en Higgsfield solo vive unos días.
        </p>
      </div>

      {!hayLlave ? (
        <section className="tarjeta p-4">
          <h2 className="font-semibold">Falta conectar Higgsfield</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            Crea una llave de API en cloud.higgsfield.ai y agrega la variable de
            entorno <code>HIGGSFIELD_CREDENTIALS=&quot;ID:SECRETO&quot;</code> en
            Vercel (y en <code>.env.local</code> para desarrollo). Sin eso no se
            puede generar nada.
          </p>
        </section>
      ) : (
        <GeneradorVideo publicaciones={publicaciones} />
      )}

      <section className="tarjeta overflow-hidden">
        <header className="flex items-center justify-between border-b p-4 hairline">
          <div>
            <h2 className="font-semibold">Generaciones</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              {(videos ?? []).length === 0
                ? "Todavía no hay ninguna."
                : enCurso > 0
                  ? `${enCurso} en el horno. Un clip tarda entre 2 y 8 minutos (primero la foto, luego la animación).`
                  : "Todo lo encolado ya terminó."}
            </p>
          </div>
          <BotonActualizar hayEnCurso={enCurso > 0} />
        </header>

        {(videos ?? []).length > 0 && (
          <div className="max-h-[44rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Producto</th>
                  <th>Escena</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(videos ?? []).map((v) => {
                  const est = ETIQUETA_ESTADO[v.estado as string] ?? {
                    texto: v.estado as string,
                    color: "var(--ink-muted)",
                  };
                  const formato = (v.formato as string) ?? "dop";
                  const esClip = formato === "clip" || formato === "hablado";
                  const generando = ["enviado", "en_progreso"].includes(v.estado as string);
                  const detalleEtapa =
                    esClip && generando
                      ? (v.etapa as string) === "imagen"
                        ? "Etapa 1/2: creando la foto 9:16"
                        : "Etapa 2/2: animando el video"
                      : null;
                  return (
                    <tr key={v.id as string}>
                      <td>
                        {v.video_guardado ? (
                          <video
                            src={v.video_guardado as string}
                            controls
                            preload="metadata"
                            poster={(v.imagen_generada as string) ?? undefined}
                            className={esClip ? "w-32 rounded-md" : "w-48 rounded-md"}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={(v.imagen_generada as string) || (v.imagen_url as string)}
                            alt=""
                            className="w-24 rounded-md opacity-60"
                          />
                        )}
                      </td>
                      <td className="align-top">
                        <div className="text-sm font-medium">{(v.titulo as string) || "—"}</div>
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {(v.item_id as string) ?? ""}
                        </div>
                        <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                          {new Date(v.creado_en as string).toLocaleString("es-MX")}
                        </div>
                      </td>
                      <td className="max-w-[16rem] align-top">
                        <div className="text-xs font-medium">
                          {(v.preset as string) ?? "propia"}
                          {formato === "clip"
                            ? " · 9:16 · 10 s"
                            : formato === "hablado"
                              ? " · habla español · 8 s"
                              : " · prueba ~5 s"}
                        </div>
                        <div
                          className="mt-0.5 line-clamp-3 text-xs"
                          style={{ color: "var(--ink-muted)" }}
                          title={v.prompt as string}
                        >
                          {v.prompt as string}
                        </div>
                      </td>
                      <td className="align-top">
                        <span className="text-sm font-medium" style={{ color: est.color }}>
                          {est.texto}
                        </span>
                        {detalleEtapa ? (
                          <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                            {detalleEtapa}
                          </div>
                        ) : null}
                        {v.error ? (
                          <div className="mt-1 max-w-[14rem] text-xs" style={{ color: "var(--estado-critico)" }}>
                            {v.error as string}
                          </div>
                        ) : null}
                      </td>
                      <td className="align-top">
                        <div className="flex flex-col items-start gap-1">
                          {v.video_guardado ? (
                            <a
                              href={v.video_guardado as string}
                              download
                              className="text-xs underline"
                              style={{ color: "var(--acento)" }}
                            >
                              Descargar MP4
                            </a>
                          ) : null}
                          <BotonBorrar id={v.id as string} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
