import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { publicacionesParaVideos } from "@/lib/servicios/videos-publicaciones";
import { credencialesHiggsfield } from "@/lib/higgsfield/client";
import {
  GeneradorVideo,
  BotonActualizar,
  BotonBorrar,
  CambiarVoz,
  EditarSubtitulos,
  ElegirImagen,
} from "@/components/videos";
import { Aviso, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  creado: { texto: "Creado", color: "var(--ink-muted)" },
  enviado: { texto: "En el horno", color: "var(--alerta-texto)" },
  en_progreso: { texto: "Generando…", color: "var(--alerta-texto)" },
  eligiendo: { texto: "Elige la imagen", color: "var(--acento)" },
  completado: { texto: "✓ Listo", color: "var(--exito-texto)" },
  fallido: { texto: "Falló", color: "var(--critico-texto)" },
  rechazado: { texto: "Rechazado", color: "var(--critico-texto)" },
};

export default async function Videos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Videos de producto" />;

  const hayLlave = Boolean(credencialesHiggsfield());

  // Las tres lecturas son independientes y van a la par. Las publicaciones
  // (una por item, ~10 mil SKUs) salen masticadas de `app_cache`
  // (`publicacionesParaVideos`, 30 min, refresco por atrás).
  const admin = clienteAdmin();
  const [{ data: conexionMcp }, publicaciones, { data: videos }] = await Promise.all([
    // ¿La CUENTA de Higgsfield (Marketing Studio) ya está conectada por OAuth?
    admin.from("higgsfield_mcp").select("account_id").eq("account_id", cuenta.id).maybeSingle(),
    publicacionesParaVideos(admin, cuenta.id),
    supabase
      .from("videos_producto")
      .select("*")
      .eq("account_id", cuenta.id)
      .order("creado_en", { ascending: false })
      .limit(200),
  ]);
  const cuentaConectada = Boolean(conexionMcp);

  const enCurso = (videos ?? []).filter((v) =>
    ["enviado", "en_progreso"].includes(v.estado as string),
  ).length;

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Videos de producto"
        descripcion="Clips verticales 9:16 para los Clips de Mercado Libre, del producto tal cual o en modo UGC."
        acciones={
          cuentaConectada ? (
            // La sesión de Higgsfield puede expirar aunque la conexión exista;
            // sin este botón no habría forma de renovarla desde la pantalla.
            <a href="/api/higgsfield/conectar" className="boton boton-borde boton-chico">
              Reconectar Higgsfield
            </a>
          ) : (
            <a href="/api/higgsfield/conectar" className="boton boton-primario">
              Conectar Higgsfield
            </a>
          )
        }
        ayuda={
          <>
            <p>
              Clip, prueba y hablado se generan directo de tus fotos reales: el producto sale tal cual, sin que la IA lo
              redibuje. En UGC una persona lo presenta hablando en español (con tu voz grabada o voz de IA, 10-15 segundos
              con lip sync); ahí la IA recrea la escena con tu foto de referencia. El video terminado se guarda aquí para
              siempre; en Higgsfield solo vive unos días.
            </p>
            <p>
              Conectar la cuenta de Higgsfield (Marketing Studio) deja usar el Marketing Studio de tu suscripción desde
              aquí: producto idéntico y la calidad de la app. Un solo login; la conexión se mantiene sola. Si algo falla,
              «Reconectar Higgsfield» renueva la sesión.
            </p>
          </>
        }
      />

      {!hayLlave ? (
        <Aviso tono="alerta" titulo="Falta conectar Higgsfield">
          Crea una llave de API en cloud.higgsfield.ai y agrega la variable de
          entorno <code>HIGGSFIELD_CREDENTIALS=&quot;ID:SECRETO&quot;</code> en
          Vercel (y en <code>.env.local</code> para desarrollo). Sin eso no se
          puede generar nada.
        </Aviso>
      ) : (
        <GeneradorVideo publicaciones={publicaciones} cuentaConectada={cuentaConectada} />
      )}

      <Seccion
        titulo="Generaciones"
        descripcion={
          (videos ?? []).length === 0
            ? "Todavía no hay ninguna."
            : enCurso > 0
              ? `${enCurso} en el horno. Un clip tarda entre 2 y 8 minutos (primero la foto, luego la animación).`
              : undefined
        }
        acciones={<BotonActualizar hayEnCurso={enCurso > 0} />}
        sinRelleno
      >

        {(videos ?? []).length > 0 && (
          <div className="tabla-caja alta">
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
                  const esClip =
                    formato === "clip" ||
                    formato === "hablado" ||
                    formato === "ugc" ||
                    formato === "studio";
                  const generando = ["enviado", "en_progreso"].includes(v.estado as string);
                  const detalleEtapa =
                    formato === "studio" && generando
                      ? v.modelo === "voice-change"
                        ? "Cambiando la voz; visuales intactos (~2-5 min)"
                        : v.modelo === "seedance-2.0" || v.modelo === "seedance-2.5"
                          ? "Seedance genera el video directo de tus fotos (~5-10 min)"
                          : "El Studio arma guion, visuales y video (10-30 min)"
                      : esClip && generando
                        ? (v.etapa as string) === "imagen"
                          ? formato === "ugc"
                            ? "Etapa 1/2: creando a la persona con el producto"
                            : "Etapa 1/2: creando la foto 9:16"
                          : "Etapa 2/2: animando el video"
                        : null;
                  return (
                    <tr key={v.id as string}>
                      <td>
                        {v.estado === "eligiendo" &&
                        Array.isArray(v.imagenes_candidatas) ? (
                          <ElegirImagen
                            id={v.id as string}
                            imagenes={v.imagenes_candidatas as string[]}
                          />
                        ) : v.video_guardado ? (
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
                        <div className="text-xs texto-tenue">
                          {(v.item_id as string) ?? ""}
                        </div>
                        <div className="mt-1 text-xs texto-tenue">
                          {new Date(v.creado_en as string).toLocaleString("es-MX")}
                        </div>
                      </td>
                      <td className="max-w-[16rem] align-top">
                        <div className="text-xs font-medium">
                          {(v.preset as string) ?? "propia"}
                          {formato === "studio"
                            ? ` · Studio · ${(v.duracion as number) ?? 15} s`
                            : formato === "clip"
                              ? " · 9:16 · 10 s"
                              : formato === "hablado"
                                ? " · habla español · 8 s"
                                : formato === "ugc"
                                  ? ` · UGC · ${(v.duracion as number) ?? 10} s`
                                  : " · prueba ~5 s"}
                        </div>
                        {v.personaje ? (
                          <div className="mt-0.5 text-xs" style={{ color: "var(--acento)" }}>
                            👤 Personaje: {v.personaje as string}
                          </div>
                        ) : null}
                        <div
                          className="mt-0.5 line-clamp-3 text-xs texto-tenue"
                         
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
                          <div className="mt-1 text-xs texto-tenue">
                            {detalleEtapa}
                          </div>
                        ) : null}
                        {v.error ? (
                          <div className="mt-1 max-w-[14rem] text-xs" style={{ color: "var(--critico-texto)" }}>
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
                              className="text-xs enlace"
                            >
                              Descargar MP4
                            </a>
                          ) : null}
                          {v.estado === "completado" && v.video_guardado ? (
                            <CambiarVoz id={v.id as string} />
                          ) : null}
                          {v.estado === "completado" && v.video_guardado && v.guion ? (
                            <EditarSubtitulos
                              id={v.id as string}
                              guion={v.guion as string}
                            />
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
      </Seccion>
    </Pagina>
  );
}
