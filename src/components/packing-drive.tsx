"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ArchivoDriveVista {
  nombre: string;
  estado: string;
  motivo: string | null;
  procesadoEn: string;
  contenedor: string | null;
}

/**
 * Packing lists que llegan solos desde la carpeta de Drive de la fábrica:
 * qué archivo entró, cuál se omitió y por qué, y el botón para traerlos
 * ahora sin esperar al cron de la mañana.
 */
export function PackingDrive({ archivos, configurado }: { archivos: ArchivoDriveVista[]; configurado: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function traer(forzar: boolean) {
    setOcupado(true);
    setError(null);
    setResumen(null);
    try {
      const r = await fetch(`/api/contenedores/drive${forzar ? "?forzar=1" : ""}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer Drive.");
      const partes = [
        `${j.archivos} archivos en la carpeta`,
        `${j.revisados} revisados`,
        `${j.importados.length} importados`,
        `${j.omitidos.length} omitidos`,
        ...(j.errores.length ? [`${j.errores.length} con error`] : []),
        ...(j.correos ?? []).map((c: { contenedor: string; enviado: boolean; motivo?: string }) =>
          c.enviado ? `correo de fotos enviado (${c.contenedor})` : `correo no enviado: ${c.motivo ?? ""}`,
        ),
      ];
      setResumen(partes.join(" · "));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Packing lists desde Drive</h2>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {configurado
            ? "Se leen solos cada mañana y entran como borrador; tú los revisas y confirmas."
            : "Sin configurar: falta la llave de Google Drive en el entorno."}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => traer(false)}
          disabled={ocupado || !configurado}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--borde)" }}
        >
          {ocupado ? "Leyendo Drive…" : "Traer de Drive ahora"}
        </button>
        <button
          onClick={() => traer(true)}
          disabled={ocupado || !configurado}
          className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
          title="Vuelve a leer también los archivos que no cambiaron"
        >
          Releer todo
        </button>
      </header>
      {resumen ? (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          {resumen}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {archivos.length ? (
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {archivos.map((a) => (
            <li key={a.nombre + a.procesadoEn} className="flex flex-wrap gap-x-3">
              <span className="font-medium">{a.nombre}</span>
              <span
                style={{
                  color:
                    a.estado === "importado"
                      ? "var(--exito-texto)"
                      : a.estado === "error"
                        ? "var(--estado-critico)"
                        : "var(--ink-muted)",
                }}
              >
                {a.estado}
                {a.contenedor ? ` → ${a.contenedor}` : ""}
              </span>
              {a.motivo ? <span style={{ color: "var(--ink-2)" }}>{a.motivo}</span> : null}
              <span className="cifra" style={{ color: "var(--ink-muted)" }}>
                {a.procesadoEn.slice(0, 16).replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
