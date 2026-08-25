"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MODELOS } from "@/lib/higgsfield/presets";
import {
  ESCENAS,
  armarPrompts,
  armarPromptsHablado,
  detectarGenero,
  detectarTipo,
  guionInicial,
  type Genero,
  type TipoCalzado,
} from "@/lib/higgsfield/escenas";

/** Lee la respuesta como JSON y, si el servidor contestó texto plano
 *  (p. ej. "Request Entity Too Large"), lo convierte en error legible. */
async function leerJson(r: Response): Promise<Record<string, unknown>> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(
      r.status === 413
        ? "Las fotos pesan demasiado para subirlas juntas. Intenta con menos fotos."
        : `El servidor contestó ${r.status}: ${texto.slice(0, 120)}`,
    );
  }
}

/** Achica una foto en el navegador (máx 1280 px, JPEG) para que el paquete
 *  completo quepa en el límite de ~4.5 MB por petición de Vercel. */
async function comprimirFoto(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const i = new Image();
      i.onload = () => resolver(i);
      i.onerror = () => rechazar(new Error("No se pudo leer la foto."));
      i.src = url;
    });
    const escala = Math.min(1, 1280 / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext("2d")!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    return lienzo.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Publicacion {
  itemId: string;
  titulo: string;
  modelo: string;
  color: string;
  skus: string[];
}

export interface Personaje {
  id: string;
  nombre: string;
  genero: string | null;
  estado: string;
}

const TIPOS_ETIQUETA: Record<TipoCalzado, string> = {
  bota: "Botas",
  sandalia: "Sandalias",
  sandalia_agua: "Sandalias de agua",
  pantufla: "Pantuflas",
  tenis: "Tenis",
  tacon: "Tacones",
  mocasin: "Mocasines",
  zapato: "Zapatos",
};

const GENEROS_ETIQUETA: Record<string, string> = {
  mujer: "Mujer",
  hombre: "Hombre",
  nino: "Niños",
};

// ---------------------------------------------------------------------------
// Personajes fijos (la influencer, el modelo)
// ---------------------------------------------------------------------------

export function PanelPersonajes({ iniciales }: { iniciales: Personaje[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [genero, setGenero] = useState("mujer");
  const [fotos, setFotos] = useState<string[]>([]);
  const [estado, setEstado] = useState<"listo" | "enviando">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const hayCreando = iniciales.some((p) => p.estado === "creando");

  async function alEscogerFotos(archivos: FileList | null) {
    if (!archivos) return;
    setMensaje(null);
    try {
      const lista = [...archivos].slice(0, 6);
      setFotos(await Promise.all(lista.map(comprimirFoto)));
    } catch (e) {
      setMensaje((e as Error).message);
    }
  }

  async function crear() {
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/videos/personajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, genero, fotos }),
      });
      const j = await leerJson(r);
      if (!r.ok) throw new Error(String(j.error ?? "No se pudo crear."));
      setAbierto(false);
      setNombre("");
      setFotos([]);
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setEstado("listo");
    }
  }

  async function refrescar() {
    await fetch("/api/videos/personajes");
    router.refresh();
  }

  async function borrar(id: string) {
    await fetch(`/api/videos/personajes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="tarjeta p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Tus personajes</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            La misma cara en todos tus videos: una influencer para dama, un modelo
            para caballero. Se entrenan una vez con 1 a 6 fotos y se reutilizan.
          </p>
        </div>
        <div className="flex gap-2">
          {hayCreando ? (
            <button
              onClick={refrescar}
              className="rounded border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", color: "var(--acento)" }}
            >
              ↻ Revisar entrenamiento
            </button>
          ) : null}
          <button
            onClick={() => setAbierto((v) => !v)}
            className="rounded px-3 py-1.5 text-sm text-white"
            style={{ background: "var(--acento)" }}
          >
            {abierto ? "Cancelar" : "+ Nuevo personaje"}
          </button>
        </div>
      </div>

      {iniciales.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {iniciales.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              style={{ borderColor: "var(--borde)" }}
            >
              <span className="font-medium">{p.nombre}</span>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                {GENEROS_ETIQUETA[p.genero ?? ""] ?? "—"}
              </span>
              <span
                className="text-xs"
                style={{
                  color:
                    p.estado === "listo"
                      ? "var(--exito-texto)"
                      : p.estado === "fallido"
                        ? "var(--estado-critico)"
                        : "var(--estado-alerta)",
                }}
              >
                {p.estado === "listo" ? "✓ Listo" : p.estado === "fallido" ? "Falló" : "Entrenando…"}
              </span>
              <button
                onClick={() => borrar(p.id)}
                className="text-xs underline"
                style={{ color: "var(--ink-muted)" }}
              >
                borrar
              </button>
            </span>
          ))}
        </div>
      )}

      {abierto && (
        <div className="mt-4 flex flex-col gap-2 border-t pt-4 hairline">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre (p. ej. Valeria)"
              className="w-48 px-2 py-1.5 text-sm"
            />
            <select value={genero} onChange={(e) => setGenero(e.target.value)} className="px-2 py-1.5 text-sm">
              <option value="mujer">Mujer</option>
              <option value="hombre">Hombre</option>
              <option value="nino">Niños</option>
            </select>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => alEscogerFotos(e.target.files)}
              className="text-xs"
            />
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            De 1 a 6 fotos claras de la misma persona (rostro y cuerpo entero ayudan).
            Tip: puedes crear a tu influencer en higgsfield.ai con tu plan Pro,
            descargar sus fotos y subirlas aquí.
          </p>
          {fotos.length > 0 && (
            <div className="flex gap-1.5">
              {fotos.map((f, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={f} alt="" className="h-14 w-14 rounded object-cover" />
              ))}
            </div>
          )}
          <div>
            <button
              onClick={crear}
              disabled={estado === "enviando" || !nombre.trim() || fotos.length === 0}
              className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {estado === "enviando" ? "Subiendo…" : "Crear personaje"}
            </button>
          </div>
          {mensaje && (
            <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
              {mensaje}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Generador de videos
// ---------------------------------------------------------------------------

export function GeneradorVideo({
  publicaciones,
  personajes,
}: {
  publicaciones: Publicacion[];
  personajes: Personaje[];
}) {
  const router = useRouter();

  const [busqueda, setBusqueda] = useState("");
  const [pub, setPub] = useState<Publicacion | null>(null);
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [imagen, setImagen] = useState("");
  const [cargandoFotos, setCargandoFotos] = useState(false);

  const [tipo, setTipo] = useState<TipoCalzado>("zapato");
  const [genero, setGenero] = useState<Genero>(null);
  const [escenaId, setEscenaId] = useState(ESCENAS[0].id);
  const [semilla, setSemilla] = useState(0.42);
  const [guion, setGuion] = useState("");
  const [promptImagen, setPromptImagen] = useState("");
  const [promptVideo, setPromptVideo] = useState("");

  const [formato, setFormato] = useState<"clip" | "hablado" | "dop">("clip");
  const [personajeId, setPersonajeId] = useState<string>("");
  const [modeloDop, setModeloDop] = useState(MODELOS[0].id);

  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const listos = personajes.filter((p) => p.estado === "listo");
  const escena = ESCENAS.find((e) => e.id === escenaId) ?? ESCENAS[0];

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return publicaciones.slice(0, 30);
    return publicaciones
      .filter((p) =>
        // También por SKU: el vendedor piensa en SKUs, no en MLMs.
        `${p.titulo} ${p.modelo} ${p.color} ${p.itemId} ${p.skus.join(" ")}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 30);
  }, [busqueda, publicaciones]);

  function regenerarPrompts(datos: {
    tipo: TipoCalzado;
    genero: Genero;
    escenaId: string;
    semilla: number;
    formato: "clip" | "hablado" | "dop";
    guion: string;
  }) {
    const prompts =
      datos.formato === "hablado"
        ? armarPromptsHablado({
            tipo: datos.tipo,
            genero: datos.genero,
            semilla: datos.semilla,
            guion: datos.guion,
          })
        : armarPrompts(datos);
    setPromptImagen(prompts.imagen);
    setPromptVideo(prompts.video);
  }

  async function escogerPublicacion(p: Publicacion) {
    setPub(p);
    setImagenes([]);
    setImagen("");
    setMensaje(null);

    // La escena se adapta al producto: botas ≠ sandalias ≠ pantuflas.
    const texto = `${p.titulo} ${p.modelo}`;
    const t = detectarTipo(texto);
    const g = detectarGenero(texto);
    const gu = guionInicial(t);
    setTipo(t);
    setGenero(g);
    setGuion(gu);
    regenerarPrompts({ tipo: t, genero: g, escenaId, semilla, formato, guion: gu });

    // Personaje del género detectado, si hay uno listo.
    const candidato = listos.find((x) => x.genero === g) ?? listos[0];
    setPersonajeId(candidato?.id ?? "");

    setCargandoFotos(true);
    try {
      const r = await fetch(`/api/videos/imagenes?item=${encodeURIComponent(p.itemId)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron traer las fotos.");
      setImagenes(j.imagenes ?? []);
      if (j.imagenes?.length) setImagen(j.imagenes[0]);
      if (!j.imagenes?.length) setMensaje("La publicación no tiene fotos.");
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setCargandoFotos(false);
    }
  }

  function cambiar(
    cambios: Partial<{
      tipo: TipoCalzado;
      genero: Genero;
      escenaId: string;
      semilla: number;
      formato: "clip" | "hablado" | "dop";
      guion: string;
    }>,
  ) {
    const t = cambios.tipo ?? tipo;
    const g = cambios.genero !== undefined ? cambios.genero : genero;
    const e = cambios.escenaId ?? escenaId;
    const s = cambios.semilla ?? semilla;
    const f = cambios.formato ?? formato;
    // Si cambió el tipo, el guion inicial se rehace para ese tipo.
    const gu = cambios.guion ?? (cambios.tipo !== undefined ? guionInicial(t) : guion);
    if (cambios.tipo !== undefined) setTipo(t);
    if (cambios.genero !== undefined) setGenero(g);
    if (cambios.escenaId !== undefined) setEscenaId(e);
    if (cambios.semilla !== undefined) setSemilla(s);
    if (cambios.formato !== undefined) setFormato(f);
    if (gu !== guion) setGuion(gu);
    regenerarPrompts({ tipo: t, genero: g, escenaId: e, semilla: s, formato: f, guion: gu });
  }

  async function generar() {
    if (!pub) return;
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: pub.itemId,
          titulo: pub.titulo,
          imagenUrl: imagen,
          formato,
          escena:
            formato === "hablado"
              ? `Hablado (${TIPOS_ETIQUETA[tipo]})`
              : `${escena.etiqueta} (${TIPOS_ETIQUETA[tipo]})`,
          prompt: promptVideo,
          promptImagen,
          personajeId:
            formato === "hablado" || (formato === "clip" && escena.conPersona)
              ? personajeId || null
              : null,
          modelo: modeloDop,
        }),
      });
      const j = await leerJson(r);
      if (!r.ok) throw new Error(String(j.error ?? "No se pudo encolar el video."));
      setEstado("ok");
      router.refresh();
      setTimeout(() => setEstado("listo"), 4000);
    } catch (e) {
      setEstado("error");
      setMensaje((e as Error).message);
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Nuevo video</h2>

      {/* 1. Publicación */}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          1 · Publicación
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Busca por SKU, título, modelo, color o MLM…"
          className="mt-1.5 w-full max-w-md px-2 py-1.5 text-sm"
        />
        {busqueda.trim() && (
          <ul className="mt-1 max-h-48 max-w-md overflow-auto rounded-md border hairline">
            {filtradas.map((p) => (
              <li key={p.itemId}>
                <button
                  onClick={() => {
                    escogerPublicacion(p);
                    setBusqueda("");
                  }}
                  className="w-full px-2 py-1.5 text-left text-sm hover:opacity-80"
                >
                  {p.titulo}
                  <span className="ml-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {p.skus[0] ?? p.itemId}
                  </span>
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="px-2 py-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                Nada con ese texto.
              </li>
            )}
          </ul>
        )}
        {pub && (
          <p className="mt-1.5 text-sm">
            <span className="font-medium">{pub.titulo}</span>{" "}
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {pub.itemId}
            </span>
          </p>
        )}
      </div>

      {/* 2. Foto */}
      {pub && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            2 · Foto de partida
          </div>
          {cargandoFotos ? (
            <p className="mt-1.5 text-sm" style={{ color: "var(--ink-muted)" }}>
              Trayendo fotos de MELI…
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {imagenes.map((url) => (
                <button
                  key={url}
                  onClick={() => setImagen(url)}
                  className="rounded-md border-2 p-0.5"
                  style={{ borderColor: imagen === url ? "var(--acento)" : "transparent" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Escena */}
      {imagen && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            3 · Escena
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span style={{ color: "var(--ink-muted)" }}>Detecté:</span>
            <select
              value={tipo}
              onChange={(e) => cambiar({ tipo: e.target.value as TipoCalzado })}
              className="px-2 py-1 text-sm"
            >
              {Object.entries(TIPOS_ETIQUETA).map(([id, etiqueta]) => (
                <option key={id} value={id}>
                  {etiqueta}
                </option>
              ))}
            </select>
            <select
              value={genero ?? ""}
              onChange={(e) => cambiar({ genero: (e.target.value || null) as Genero })}
              className="px-2 py-1 text-sm"
            >
              <option value="">Género —</option>
              <option value="mujer">Mujer</option>
              <option value="hombre">Hombre</option>
              <option value="nino">Niños</option>
            </select>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {formato !== "hablado" &&
              ESCENAS.map((e) => (
                <button
                  key={e.id}
                  onClick={() => cambiar({ escenaId: e.id })}
                  title={e.descripcion}
                  className="rounded-full border px-3 py-1 text-xs"
                  style={{
                    borderColor: escenaId === e.id ? "var(--acento)" : "var(--borde)",
                    color: escenaId === e.id ? "var(--acento)" : "var(--ink-1)",
                    fontWeight: escenaId === e.id ? 600 : 400,
                  }}
                >
                  {e.etiqueta}
                </button>
              ))}
            <button
              onClick={() => cambiar({ semilla: Math.random() })}
              title="Otra locación, luz y movimiento con la misma escena"
              className="rounded-full border px-3 py-1 text-xs"
              style={{ borderColor: "var(--borde)", color: "var(--acento)" }}
            >
              🎲 Variar
            </button>
          </div>

          {formato === "hablado" && (
            <label className="mt-2 flex max-w-2xl flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ink-muted)" }}>
                Guion (lo que dice a cámara, en español)
              </span>
              <textarea
                value={guion}
                onChange={(e) => cambiar({ guion: e.target.value })}
                rows={2}
                className="w-full px-2 py-1.5 text-xs"
              />
            </label>
          )}

          {(formato === "hablado" || (formato === "clip" && escena.conPersona)) && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ink-muted)" }}>Personaje:</span>
              <select
                value={personajeId}
                onChange={(e) => setPersonajeId(e.target.value)}
                className="px-2 py-1 text-sm"
              >
                <option value="">Sin personaje fijo (cara nueva cada vez)</option>
                {listos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({GENEROS_ETIQUETA[p.genero ?? ""] ?? "—"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {formato !== "dop" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink-muted)" }}>
                  Prompt de la foto 9:16 (etapa 1)
                </span>
                <textarea
                  value={promptImagen}
                  onChange={(e) => setPromptImagen(e.target.value)}
                  rows={4}
                  className="w-full px-2 py-1.5 text-xs"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ink-muted)" }}>
                Prompt del movimiento {formato === "clip" ? "(etapa 2)" : ""}
              </span>
              <textarea
                value={promptVideo}
                onChange={(e) => setPromptVideo(e.target.value)}
                rows={4}
                className="w-full px-2 py-1.5 text-xs"
              />
            </label>
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Puedes editarlos. En inglés funciona mejor; el 🎲 cambia locación, luz,
            atuendo y movimiento sin que tengas que escribir nada.
          </p>

          {/* 4. Formato */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={formato}
              onChange={(e) => cambiar({ formato: e.target.value as "clip" | "hablado" | "dop" })}
              className="px-2 py-1.5 text-sm"
            >
              <option value="clip">Clip para MELI — 9:16 · 10 s (MELI le pone música)</option>
              <option value="hablado">Hablado — presenta el producto en español · 8 s (para redes)</option>
              <option value="dop">Prueba rápida — ~5 s (no sirve para Clips)</option>
            </select>

            {formato === "dop" && (
              <select
                value={modeloDop}
                onChange={(e) => setModeloDop(e.target.value as typeof modeloDop)}
                className="px-2 py-1.5 text-sm"
              >
                {MODELOS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.etiqueta} — {m.nota}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={generar}
              disabled={estado === "enviando" || !promptVideo.trim()}
              className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {estado === "enviando" ? "Encolando…" : "Generar video"}
            </button>

            {estado === "ok" && (
              <span className="text-sm" style={{ color: "var(--exito-texto)" }}>
                ✓ En el horno; abajo aparece cómo va.
              </span>
            )}
          </div>
        </div>
      )}

      {mensaje && (
        <p className="mt-2 text-sm" style={{ color: "var(--estado-critico)" }}>
          {mensaje}
        </p>
      )}
    </section>
  );
}

/** Revisa el avance con Higgsfield y refresca la tabla. */
export function BotonActualizar({ hayEnCurso }: { hayEnCurso: boolean }) {
  const router = useRouter();
  const [girando, setGirando] = useState(false);

  async function actualizar() {
    setGirando(true);
    try {
      await fetch("/api/videos/procesar", { method: "POST" });
      // Un momento para que el vigilante alcance a preguntar al menos una vez.
      await new Promise((r) => setTimeout(r, 4000));
      router.refresh();
    } finally {
      setGirando(false);
    }
  }

  return (
    <button
      onClick={actualizar}
      disabled={girando}
      className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
      style={{ borderColor: "var(--borde)", color: hayEnCurso ? "var(--acento)" : "var(--ink-2)" }}
    >
      {girando ? "Revisando…" : "↻ Actualizar"}
    </button>
  );
}

/** Quita un intento de la lista. */
export function BotonBorrar({ id }: { id: string }) {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);

  async function borrar() {
    setBorrando(true);
    try {
      await fetch(`/api/videos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBorrando(false);
    }
  }

  return (
    <button
      onClick={borrar}
      disabled={borrando}
      className="text-xs underline disabled:opacity-50"
      style={{ color: "var(--ink-muted)" }}
    >
      {borrando ? "…" : "Borrar"}
    </button>
  );
}
