"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PRESETS, MODELOS } from "@/lib/higgsfield/presets";

export interface Publicacion {
  itemId: string;
  titulo: string;
  modelo: string;
  color: string;
}

/**
 * Formulario para encolar un video: se escoge la publicación, una de sus
 * fotos, una receta (o prompt propio) y el modelo. Todo lo pesado pasa en el
 * servidor; aquí solo se arma la petición.
 */
export function GeneradorVideo({ publicaciones }: { publicaciones: Publicacion[] }) {
  const router = useRouter();

  const [busqueda, setBusqueda] = useState("");
  const [itemId, setItemId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [imagen, setImagen] = useState("");
  const [cargandoFotos, setCargandoFotos] = useState(false);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [modelo, setModelo] = useState(MODELOS[0].id);
  const [estado, setEstado] = useState<"listo" | "enviando" | "ok" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return publicaciones.slice(0, 30);
    return publicaciones
      .filter((p) =>
        `${p.titulo} ${p.modelo} ${p.color} ${p.itemId}`.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [busqueda, publicaciones]);

  async function escogerPublicacion(p: Publicacion) {
    setItemId(p.itemId);
    setTitulo(p.titulo);
    setImagenes([]);
    setImagen("");
    setMensaje(null);
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

  function escogerPreset(id: string) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) setPrompt(p.prompt);
  }

  async function generar() {
    setEstado("enviando");
    setMensaje(null);
    try {
      const r = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, titulo, imagenUrl: imagen, prompt, preset, modelo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo encolar el video.");
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
          placeholder="Busca por título, modelo, color o MLM…"
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
                    {p.itemId}
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
        {itemId && (
          <p className="mt-1.5 text-sm">
            <span className="font-medium">{titulo}</span>{" "}
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {itemId}
            </span>
          </p>
        )}
      </div>

      {/* 2. Foto */}
      {itemId && (
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
                  style={{
                    borderColor: imagen === url ? "var(--acento)" : "transparent",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Receta */}
      {imagen && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            3 · Receta del video
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => escogerPreset(p.id)}
                title={p.descripcion}
                className="rounded-full border px-3 py-1 text-xs"
                style={{
                  borderColor: preset === p.id ? "var(--acento)" : "var(--borde)",
                  color: preset === p.id ? "var(--acento)" : "var(--ink-1)",
                  fontWeight: preset === p.id ? 600 : 400,
                }}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-2 w-full max-w-2xl px-2 py-1.5 text-xs"
          />
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Puedes editarlo. En inglés funciona mejor; describe el movimiento, no el zapato.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={modelo}
              onChange={(e) => setModelo(e.target.value as typeof modelo)}
              className="px-2 py-1.5 text-sm"
            >
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.etiqueta} — {m.nota}
                </option>
              ))}
            </select>

            <button
              onClick={generar}
              disabled={estado === "enviando" || !prompt.trim()}
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
