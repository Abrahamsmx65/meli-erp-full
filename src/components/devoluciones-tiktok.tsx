"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PackageCheck, RefreshCw, Search, Trash2 } from "lucide-react";
import { Ficha } from "./tiles";
import {
  coincideBusqueda,
  contarPorGrupo,
  diasDesde,
  grupoDeDevolucion,
  porVencer,
  type DestinoDevolucion,
  type GrupoDevolucion,
} from "@/lib/tiktok/devoluciones";
import type { DevolucionGuardada } from "@/lib/servicios/tiktok-devoluciones";

const TITULOS: Record<GrupoDevolucion, string> = {
  por_recibir: "Por recibir: el cliente ya la mandó, falta confirmar el paquete",
  esperando_cliente: "En espera del cliente: aprobada, todavía no la manda",
  pendiente_tiktok: "Pendientes de TikTok: solicitadas y aún sin aprobar",
  recibida: "Recibidas y reembolsadas",
  cerrada: "Cerradas: rechazadas, canceladas o solo reembolso",
};

const ESTADOS: Record<string, string> = {
  RETURN_OR_REFUND_REQUEST_PENDING: "Solicitada",
  REFUND_OR_RETURN_REQUEST_REJECT: "Rechazada",
  AWAITING_BUYER_SHIP: "Esperando que el cliente la mande",
  BUYER_SHIPPED_ITEM: "El cliente ya la mandó",
  REJECT_RECEIVE_PACKAGE: "Paquete rechazado",
  RETURN_OR_REFUND_REQUEST_SUCCESS: "Reembolsada",
  RETURN_OR_REFUND_REQUEST_CANCEL: "Cancelada",
  RETURN_OR_REFUND_REQUEST_COMPLETE: "Completa",
};

const TIPOS: Record<string, string> = {
  REFUND: "Solo reembolso",
  RETURN_AND_REFUND: "Devolución y reembolso",
  REPLACEMENT: "Reemplazo",
};

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dinero(n: number | null, moneda: string | null): string {
  if (n == null) return "";
  return `${moneda === "MXN" || !moneda ? "$" : moneda + " "}${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DevolucionesTikTok({ devoluciones, ahora }: { devoluciones: DevolucionGuardada[]; ahora: number }) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  const conteo = useMemo(() => contarPorGrupo(devoluciones), [devoluciones]);
  const vencen = useMemo(() => porVencer(devoluciones, ahora), [devoluciones, ahora]);
  const encontradas = useMemo(
    () => (busqueda.trim().length >= 4 ? devoluciones.filter((d) => coincideBusqueda(d, busqueda)) : null),
    [devoluciones, busqueda],
  );

  const grupos = useMemo(() => {
    const m = new Map<GrupoDevolucion, DevolucionGuardada[]>();
    for (const d of devoluciones) {
      const g = grupoDeDevolucion(d);
      const l = m.get(g) ?? [];
      l.push(d);
      m.set(g, l);
    }
    return m;
  }, [devoluciones]);

  async function actualizar() {
    setActualizando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/tiktok/devoluciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "sincronizar" }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(`TikTok contestó ${j.leidas} devoluciones${j.completo ? "" : " (lista incompleta, se termina en el cron)"}.`);
      router.refresh();
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setActualizando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="Por recibir" valor={String(conteo.por_recibir)} nota={vencen.length ? `${vencen.length} vencen en menos de 48 h` : "falta confirmar el paquete"} tono={vencen.length ? "critico" : conteo.por_recibir ? "alerta" : "neutro"} />
        <Ficha titulo="En espera del cliente" valor={String(conteo.esperando_cliente)} nota="aprobadas, aún no las mandan" />
        <Ficha titulo="Pendientes de TikTok" valor={String(conteo.pendiente_tiktok)} nota="solicitadas, sin aprobar" />
        <Ficha titulo="Recibidas" valor={String(conteo.recibida)} nota="reembolsadas" />
        <Ficha titulo="Cerradas" valor={String(conteo.cerrada)} nota="rechazadas o canceladas" />
      </div>

      <div className="tarjeta flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <label className="flex flex-1 items-center gap-2">
          <Search size={18} style={{ color: "var(--ink-2)" }} />
          <input
            ref={campo}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escanea la guía de regreso o teclea el pedido, la devolución o el SKU"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={actualizar} disabled={actualizando} className="boton-secundario flex items-center gap-2">
          <RefreshCw size={16} className={actualizando ? "animate-spin" : ""} />
          {actualizando ? "Leyendo TikTok…" : "Actualizar"}
        </button>
      </div>
      {aviso ? (
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          {aviso}
        </p>
      ) : null}

      {encontradas ? (
        <Seccion titulo={encontradas.length ? `${encontradas.length} ${encontradas.length === 1 ? "devolución encontrada" : "devoluciones encontradas"}` : "No hay ninguna devolución con eso"} lista={encontradas} ahora={ahora} abiertas />
      ) : (
        (["por_recibir", "esperando_cliente", "pendiente_tiktok", "recibida", "cerrada"] as GrupoDevolucion[]).map((g) => {
          const lista = grupos.get(g) ?? [];
          if (!lista.length) return null;
          return <Seccion key={g} titulo={`${TITULOS[g]} (${lista.length})`} lista={lista} ahora={ahora} abiertas={g === "por_recibir"} />;
        })
      )}
      {!devoluciones.length ? (
        <p className="tarjeta p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay devoluciones leídas. Dale a «Actualizar» o espera al cron de TikTok (cada 15 minutos).
        </p>
      ) : null}
    </div>
  );
}

function Seccion({ titulo, lista, ahora, abiertas }: { titulo: string; lista: DevolucionGuardada[]; ahora: number; abiertas: boolean }) {
  return (
    <section className="tarjeta overflow-hidden">
      <h2 className="px-4 pt-4 font-semibold">{titulo}</h2>
      <div className="divide-y">
        {lista.map((d) => (
          <Renglon key={d.returnId} d={d} ahora={ahora} abierta={abiertas} />
        ))}
      </div>
    </section>
  );
}

function Renglon({ d, ahora, abierta }: { d: DevolucionGuardada; ahora: number; abierta: boolean }) {
  const router = useRouter();
  const grupo = grupoDeDevolucion(d);
  const puedeConfirmar = grupo === "por_recibir" && !d.confirmadaEn;
  const [decisiones, setDecisiones] = useState<Record<string, DestinoDevolucion>>(() =>
    Object.fromEntries(d.renglones.map((r) => [r.returnLineItemId, "stock" as DestinoDevolucion])),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(d.error);
  const [hecho, setHecho] = useState<string | null>(null);
  const dias = diasDesde(d.actualizadaEn ?? d.creadaEn, ahora);
  const plazoMs = d.plazo ? Date.parse(d.plazo) : NaN;
  const plazoVencido = Number.isFinite(plazoMs) && plazoMs < ahora;
  const plazoCerca = Number.isFinite(plazoMs) && !plazoVencido && plazoMs - ahora < 48 * 3_600_000;

  async function confirmar() {
    if (!window.confirm("¿Confirmar que el paquete llegó? TikTok le reembolsa al cliente en ese momento.")) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/devoluciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "confirmar",
          returnId: d.returnId,
          decisiones: Object.entries(decisiones).map(([returnLineItemId, destino]) => ({ returnLineItemId, destino })),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setHecho(`Confirmada. ${j.movimientos} ${j.movimientos === 1 ? "movimiento" : "movimientos"} en el kardex.${j.avisos?.length ? " " + j.avisos.join(" ") : ""}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <details open={abierta} className="px-4 py-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-mono font-semibold">{d.orderId}</span>
        <span>{d.renglones.map((r) => r.sku ?? r.sellerSku ?? "(sin SKU)").join(", ")}</span>
        <span style={{ color: "var(--ink-2)" }}>{d.renglones.length} {d.renglones.length === 1 ? "par" : "pares"}</span>
        {d.guia ? (
          <span className="font-mono" style={{ color: "var(--ink-2)" }}>
            {d.paqueteria ? `${d.paqueteria} · ` : ""}
            {d.guia}
          </span>
        ) : null}
        {d.corte ? <span style={{ color: "var(--ink-2)" }}>corte #{d.corte}</span> : null}
        <span className="ml-auto" style={{ color: plazoVencido ? "var(--estado-critico)" : plazoCerca ? "var(--estado-alerta)" : "var(--ink-2)" }}>
          {d.confirmadaEn
            ? `Recibida ${fechaCorta(d.confirmadaEn)}`
            : grupo === "por_recibir" && d.plazo
              ? `${plazoVencido ? "Plazo vencido" : "Plazo"} ${fechaCorta(d.plazo)}`
              : ESTADOS[d.estado] ?? d.estado}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-sm">
        <p style={{ color: "var(--ink-2)" }}>
          {TIPOS[d.tipo ?? ""] ?? d.tipo ?? ""} · {ESTADOS[d.estado] ?? d.estado}
          {d.motivoTexto || d.motivo ? ` · Motivo: ${d.motivoTexto ?? d.motivo}` : ""}
          {d.reembolso != null ? ` · Reembolso ${dinero(d.reembolso, d.moneda)}` : ""}
          {dias != null ? ` · hace ${dias} ${dias === 1 ? "día" : "días"}` : ""}
          {` · devolución ${d.returnId}`}
        </p>
        {d.decisiones.length ? (
          <ul className="flex flex-wrap gap-3">
            {d.renglones.map((r) => {
              const dec = d.decisiones.find((x) => x.returnLineItemId === r.returnLineItemId);
              return (
                <li key={r.returnLineItemId} className="flex items-center gap-1">
                  {dec?.destino === "basura" ? <Trash2 size={14} /> : <PackageCheck size={14} />}
                  {r.sku ?? r.sellerSku}: {dec?.destino === "basura" ? "se tiró" : dec ? "volvió al stock" : "sin decisión"}
                </li>
              );
            })}
          </ul>
        ) : puedeConfirmar ? (
          <div className="flex flex-col gap-2">
            {d.renglones.map((r) => (
              <div key={r.returnLineItemId} className="flex flex-wrap items-center gap-3">
                <span className="w-56 font-mono">{r.sku ?? <span style={{ color: "var(--estado-critico)" }}>{r.sellerSku ?? r.skuId} · sin SKU del ERP</span>}</span>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`dest-${d.returnId}-${r.returnLineItemId}`} checked={decisiones[r.returnLineItemId] === "stock"} onChange={() => setDecisiones({ ...decisiones, [r.returnLineItemId]: "stock" })} />
                  <PackageCheck size={14} /> Vuelve al stock
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`dest-${d.returnId}-${r.returnLineItemId}`} checked={decisiones[r.returnLineItemId] === "basura"} onChange={() => setDecisiones({ ...decisiones, [r.returnLineItemId]: "basura" })} />
                  <Trash2 size={14} /> Se tira
                </label>
              </div>
            ))}
            <div>
              <button type="button" onClick={confirmar} disabled={guardando} className="boton-primario flex items-center gap-2">
                <CheckCircle2 size={16} />
                {guardando ? "Confirmando en TikTok…" : "Recibido: reembolsar y mover el kardex"}
              </button>
            </div>
          </div>
        ) : null}
        {hecho ? <p style={{ color: "var(--estado-bien)" }}>{hecho}</p> : null}
        {error ? <p style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      </div>
    </details>
  );
}
