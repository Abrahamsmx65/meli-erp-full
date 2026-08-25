"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MODELOS } from "@/lib/higgsfield/presets";
import {
  ESCENAS,
  armarPromptProducto,
  armarPromptHablado,
  detectarGenero,
  detectarTipo,
  guionInicial,
  type Genero,
  type TipoCalzado,
} from "@/lib/higgsfield/escenas";

export interface Publicacion {
  itemId: string;
  titulo: string;
  modelo: string;
  color: string;
  skus: string[];
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

/** Lee la respuesta como JSON y, si el servidor contestó texto plano
 *  (p. ej. "Request Entity Too Large"), lo convierte en error legible. */
async function leerJson(r: Response): Promise<Record<string, unknown>> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`El servidor contestó ${r.status}: ${texto.slice(0, 120)}`);
  }
}

/**
 * Arma el lienzo vertical 9:16 con la foto REAL, sin IA: la misma foto
 * difuminada de fondo y encima el producto tal cual, completo y centrado.
 * La foto pasa por nuestro proxy porque el CDN de MELI no manda CORS.
 */
async function armarLienzo(fotoUrl: string): Promise<string> {
  const r = await fetch(`/api/videos/imagenes?proxy=${encodeURIComponent(fotoUrl)}`);
  if (!r.ok) throw new Error("No se pudo descargar la foto para el lienzo.");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const i = new Image();
      i.onload = () => resolver(i);
      i.onerror = () => rechazar(new Error("No se pudo leer la foto."));
      i.src = url;
    });

    const ANCHO = 1152;
    const ALTO = 2048;
    const lienzo = document.createElement("canvas");
    lienzo.width = ANCHO;
    lienzo.height = ALTO;
    const ctx = lienzo.getContext("2d")!;

    // Fondo: la misma foto estirada a cubrir, difuminada.
    const escalaFondo = Math.max(ANCHO / img.width, ALTO / img.height);
    ctx.filter = "blur(40px) brightness(0.9)";
    ctx.drawImage(
      img,
      (ANCHO - img.width * escalaFondo) / 2,
      (ALTO - img.height * escalaFondo) / 2,
      img.width * escalaFondo,
      img.height * escalaFondo,
    );
    ctx.filter = "none";

    // Producto: la foto completa, centrada, SIN recortar ni tocar.
    const escala = Math.min(ANCHO / img.width, (ALTO * 0.72) / img.height);
    const w = img.width * escala;
    const h = img.height * escala;
    ctx.drawImage(img, (ANCHO - w) / 2, (ALTO - h) / 2, w, h);

    return lienzo.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Generador de videos
// ---------------------------------------------------------------------------

export function GeneradorVideo({ publicaciones }: { publicaciones: Publicacion[] }) {
  const router = useRouter();

  const [busqueda, setBusqueda] = useState("");
  const [pub, setPub] = useState<Publicacion | null>(null);
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [cargandoFotos, setCargandoFotos] = useState(false);

  const [tipo, setTipo] = useState<TipoCalzado>("zapato");
  const [genero, setGenero] = useState<Genero>(null);
  const [escenaId, setEscenaId] = useState(ESCENAS[0].id);
  const [semilla, setSemilla] = useState(0.42);
  const [guion, setGuion] = useState("");
  const [promptVideo, setPromptVideo] = useState("");

  const [formato, setFormato] = useState<"clip" | "hablado" | "dop">("clip");
  const [modeloDop, setModeloDop] = useState(MODELOS[0].id);

  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const escena = ESCENAS.find((e) => e.id === escenaId) ?? ESCENAS[0];
  const principal = seleccion[0] ?? "";

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

  function regenerarPrompt(datos: {
    tipo: TipoCalzado;
    genero: Genero;
    escenaId: string;
    semilla: number;
    formato: "clip" | "hablado" | "dop";
    guion: string;
  }) {
    setPromptVideo(
      datos.formato === "hablado"
        ? armarPromptHablado({
            tipo: datos.tipo,
            genero: datos.genero,
            semilla: datos.semilla,
            guion: datos.guion,
          })
        : armarPromptProducto(datos),
    );
  }

  async function escogerPublicacion(p: Publicacion) {
    setPub(p);
    setImagenes([]);
    setSeleccion([]);
    setMensaje(null);

    // La escena se adapta al producto: botas ≠ sandalias ≠ pantuflas.
    const texto = `${p.titulo} ${p.modelo}`;
    const t = detectarTipo(texto);
    const g = detectarGenero(texto);
    const gu = guionInicial(t);
    setTipo(t);
    setGenero(g);
    setGuion(gu);
    regenerarPrompt({ tipo: t, genero: g, escenaId, semilla, formato, guion: gu });

    setCargandoFotos(true);
    try {
      const r = await fetch(`/api/videos/imagenes?item=${encodeURIComponent(p.itemId)}`);
      const j = await leerJson(r);
      if (!r.ok) throw new Error(String(j.error ?? "No se pudieron traer las fotos."));
      const fotos = (j.imagenes as string[]) ?? [];
      setImagenes(fotos);
      if (fotos.length) setSeleccion([fotos[0]]);
      else setMensaje("La publicación no tiene fotos.");
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setCargandoFotos(false);
    }
  }

  function alternarFoto(url: string) {
    setSeleccion((s) => (s.includes(url) ? s.filter((x) => x !== url) : [...s, url]));
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
    regenerarPrompt({ tipo: t, genero: g, escenaId: e, semilla: s, formato: f, guion: gu });
  }

  async function generar() {
    if (!pub || !principal) return;
    setEstado("enviando");
    setMensaje(null);
    try {
      // El lienzo 9:16 se arma aquí, con la foto real, sin IA de por medio.
      const imagenLienzo =
        formato === "clip" || formato === "hablado" ? await armarLienzo(principal) : null;

      const r = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: pub.itemId,
          titulo: pub.titulo,
          imagenUrl: principal,
          imagenLienzo,
          fotos: seleccion,
          formato,
          escena:
            formato === "hablado"
              ? `Hablado (${TIPOS_ETIQUETA[tipo]})`
              : `${escena.etiqueta} (${TIPOS_ETIQUETA[tipo]})`,
          prompt: promptVideo,
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
      <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
        El video se genera directo de tus fotos reales: el producto sale tal cual,
        sin que la IA lo redibuje.
      </p>

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

      {/* 2. Fotos */}
      {pub && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            2 · Fotos del producto
          </div>
          {cargandoFotos ? (
            <p className="mt-1.5 text-sm" style={{ color: "var(--ink-muted)" }}>
              Trayendo fotos de MELI…
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {imagenes.map((url) => {
                  const posicion = seleccion.indexOf(url);
                  return (
                    <button
                      key={url}
                      onClick={() => alternarFoto(url)}
                      className="relative rounded-md border-2 p-0.5"
                      style={{ borderColor: posicion >= 0 ? "var(--acento)" : "transparent" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
                      {posicion >= 0 && (
                        <span
                          className="cifra absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: "var(--acento)" }}
                        >
                          {posicion + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                Marca varias: la 1 es la principal del video; en la prueba rápida
                todas se mandan de referencia a la IA.
              </p>
            </>
          )}
        </div>
      )}

      {/* 3. Escena */}
      {principal && (
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
              title="Otra luz y otro movimiento de cámara"
              className="rounded-full border px-3 py-1 text-xs"
              style={{ borderColor: "var(--borde)", color: "var(--acento)" }}
            >
              🎲 Variar
            </button>
          </div>

          {formato === "hablado" && (
            <label className="mt-2 flex max-w-2xl flex-col gap-1">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ink-muted)" }}>
                Guion (la voz en off lo dice en español)
              </span>
              <textarea
                value={guion}
                onChange={(e) => cambiar({ guion: e.target.value })}
                rows={2}
                className="w-full px-2 py-1.5 text-xs"
              />
            </label>
          )}

          <label className="mt-3 flex max-w-2xl flex-col gap-1">
            <span className="text-[11px] font-semibold" style={{ color: "var(--ink-muted)" }}>
              Prompt del video (movimiento, luz; el producto no se toca)
            </span>
            <textarea
              value={promptVideo}
              onChange={(e) => setPromptVideo(e.target.value)}
              rows={4}
              className="w-full px-2 py-1.5 text-xs"
            />
          </label>
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Puedes editarlo. En inglés funciona mejor; el 🎲 cambia luz y movimiento
            sin que tengas que escribir nada.
          </p>

          {/* 4. Formato */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={formato}
              onChange={(e) => cambiar({ formato: e.target.value as "clip" | "hablado" | "dop" })}
              className="px-2 py-1.5 text-sm"
            >
              <option value="clip">Clip para MELI — 9:16 · 10 s (MELI le pone música)</option>
              <option value="hablado">Hablado — voz en español presenta el producto · 8 s</option>
              <option value="dop">Prueba rápida — ~5 s, usa todas las fotos marcadas</option>
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
