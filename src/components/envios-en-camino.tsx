"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EnvioEnCamino {
  id: string;
  folio: string | null;
  bodegas: string[];
  cajas: number;
  pares: number;
  enviadoEn: string;
  estado: "enviado" | "caducado" | "recibido";
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias < 1) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

/**
 * Envíos ya dados de alta en MELI que siguen en camino.
 *
 * Mientras estén aquí, sus cajas no cuentan como disponibles y sus pares
 * cuentan como en camino. Cuando MELI avise que llegó, un clic lo cierra;
 * si nadie lo cierra, se cierra solo a los 21 días.
 */
export function EnviosEnCamino({ envios }: { envios: EnvioEnCamino[] }) {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const router = useRouter();

  const recibido = async (id: string) => {
    if (trabajando) return;
    if (!confirm("¿MELI ya recibió este envío en Full?")) return;
    setTrabajando(id);
    try {
      const r = await fetch("/api/envios", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo marcar.");
      router.refresh();
    } catch {
      setTrabajando(null);
    }
  };

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">En camino a Full</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Envíos ya dados de alta en Mercado Libre. Se usan SOLO para calcular qué
          mandar (sus pares cuentan a favor del plan) — no descuentan inventario de
          nada. A los 7 días caducan solos, porque para entonces el stock ya está en
          Full y MELI ya lo cuenta.
        </p>
      </header>
      {envios.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay envíos registrados en camino. Si ya diste de alta alguno en MELI y no
          pasó por el botón del plan, regístralo aquí abajo para que el sistema lo
          cuente.
        </p>
      ) : null}
      <ul>
        {envios.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center gap-4 border-b p-4 last:border-b-0 hairline"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {e.folio ? `Envío ${e.folio}` : e.bodegas.length ? e.bodegas.join(" y ") : "Envío"}
                {e.cajas > 0 ? (
                  <>
                    {" "}· <span className="cifra">{n(e.cajas)}</span> cajas
                  </>
                ) : null}{" "}
                · <span className="cifra">{n(e.pares)}</span> pares
              </div>
              <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Dado de alta {hace(e.enviadoEn)}
              </div>
            </div>
            {e.estado === "enviado" ? (
              <button
                onClick={() => recibido(e.id)}
                disabled={trabajando === e.id}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                style={{
                  borderColor: "var(--borde)",
                  opacity: trabajando === e.id ? 0.6 : 1,
                }}
              >
                {trabajando === e.id ? "Cerrando…" : "Ya llegó a Full"}
              </button>
            ) : (
              <span
                className="rounded-full px-2.5 py-1 text-xs font-medium"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--ink-muted)",
                }}
              >
                {e.estado === "caducado" ? "Caducado" : "Recibido"}
              </span>
            )}
          </li>
        ))}
      </ul>

      <RegistrarManual />
    </section>
  );
}

/**
 * Registro a mano de un envío que ya va en camino: folio de MELI y la lista
 * de SKU + pares (pégala del contenido del envío en Gestión de envíos, o de
 * la hoja "Picking por talla" del Excel con el que se armó).
 */
function RegistrarManual() {
  const [abierto, setAbierto] = useState(false);
  const [folio, setFolio] = useState("");
  const [pegado, setPegado] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const registrar = async () => {
    const renglones = pegado
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const partes = l.split(/[\t,;]+|\s{2,}|\s+(?=\d+$)/).filter(Boolean);
        return { sku: partes[0] ?? "", pares: Number(partes[1] ?? 0) };
      })
      .filter((r) => r.sku && r.pares > 0);

    if (!renglones.length) {
      setError("Pega un SKU por renglón con sus pares al lado (SKU 48).");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/envios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folio, renglones }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo registrar.");
      setFolio("");
      setPegado("");
      setAbierto(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="border-t p-4 hairline">
      {!abierto ? (
        <button
          onClick={() => setAbierto(true)}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: "var(--borde)" }}
        >
          Registrar un envío que ya va en camino
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            Pega la lista del envío: un SKU por renglón y sus pares al lado (sale del
            contenido del envío en Gestión de envíos de MELI, o de la hoja "Picking por
            talla" del Excel con el que lo armaste).
          </p>
          <input
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
            placeholder="Folio del envío en MELI (ej. 74713738)"
            className="max-w-xs rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={6}
            placeholder={"GT104-BLK-25-MX\t48\nGT204-PINK-23-MX\t24"}
            className="w-full rounded-lg border px-2 py-1.5 font-mono text-xs"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          {error ? (
            <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              onClick={() => setAbierto(false)}
              disabled={guardando}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              Cancelar
            </button>
            <button
              onClick={registrar}
              disabled={guardando || !pegado.trim()}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {guardando ? "Registrando…" : "Registrar envío"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
