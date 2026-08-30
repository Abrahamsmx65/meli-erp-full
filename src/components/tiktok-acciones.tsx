"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Los dos botones del almacén de TikTok.
 *
 * Están separados porque resuelven cosas distintas: "Sincronizar" va por los
 * pedidos nuevos (y de paso publica), mientras que "Publicar" solo empuja el
 * disponible sin gastar la cuota de pedidos — que es lo que se quiere después
 * de capturar entradas a mano.
 */
export function AccionesTikTok({ porPublicar }: { porPublicar: number }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function leer(r: Response) {
    const texto = await r.text();
    try {
      return JSON.parse(texto);
    } catch {
      throw new Error(
        r.status === 504
          ? "La sincronización se pasó del tiempo máximo. Vuelve a darle: retoma donde se quedó."
          : `El servidor contestó algo que no se pudo leer (${r.status}).`,
      );
    }
  }

  async function correr(tarea: "sincronizar" | "publicar") {
    setOcupado(tarea);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch(`/api/tiktok/${tarea}`, { method: "POST" });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo completar.");

      if (tarea === "sincronizar") {
        const partes = [
          `${j.pedidos} pedidos`,
          `${j.salidas} salidas`,
          `${j.publicados} SKU publicados en TikTok`,
        ];
        if (j.devoluciones) partes.push(`${j.devoluciones} devoluciones`);
        if (j.sinAmarre) partes.push(`${j.sinAmarre} renglones sin SKU amarrado`);
        setAviso(partes.join(" · "));
      } else {
        setAviso(
          j.publicados
            ? `${j.publicados} SKU actualizados en TikTok.`
            : "Nada por publicar: TikTok ya tiene el disponible al día.",
        );
      }
      if (j.avisos?.length) setError(j.avisos.join(" · "));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => correr("sincronizar")}
          disabled={ocupado !== null}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {ocupado === "sincronizar" ? "Sincronizando…" : "Sincronizar con TikTok"}
        </button>

        <button
          onClick={() => correr("publicar")}
          disabled={ocupado !== null}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--grid)" }}
        >
          {ocupado === "publicar"
            ? "Publicando…"
            : porPublicar
              ? `Publicar disponibilidad (${porPublicar})`
              : "Publicar disponibilidad"}
        </button>
      </div>

      {aviso ? (
        <p className="text-xs" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
