"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Eye, FileText, PackageX, Printer, RefreshCw, ScanLine, Scissors, ShieldCheck } from "lucide-react";
import { agruparErrores } from "@/lib/tiktok/despacho";

export interface CorteResumen {
  id: number;
  numero: number;
  creadoEn: string;
  pedidos: number;
  pares: number;
  handover: string;
  errores: { orderId: string; error: string }[];
  /** paquetes que ya pasaron los tres escaneos; null = no se pudo leer */
  preparados: number | null;
  /** pedidos cancelados después del corte: conservan su número, ya no faltan */
  cancelados?: number;
  /** pedidos que ya se fueron con el repartidor sin escanearse: resueltos, ya no faltan */
  enviados?: number;
}

/** Los pedidos del corte que siguen vivos: los que entraron menos los cancelados después. */
function vivosDe(c: CorteResumen): number {
  return Math.max(0, c.pedidos - (c.cancelados ?? 0));
}

/** Lo que ya no falta: escaneado en la estación, o ya en camino sin escanear. */
function listosDe(c: CorteResumen): number | null {
  return c.preparados == null ? null : c.preparados + (c.enviados ?? 0);
}

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * La rutina de la mañana en un botón. "Hacer corte" confirma en TikTok todo
 * lo pendiente y lo deja guardado; de cada corte salen las etiquetas y la
 * lista de empaque, en el mismo orden y con los mismos números, y se
 * reimprimen cuantas veces haga falta.
 */
export function DespachoTikTok({ pendientes, cortes }: { pendientes: number; cortes: CorteResumen[] }) {
  const router = useRouter();
  const [handover, setHandover] = useState<"PICKUP" | "DROP_OFF">("PICKUP");
  const [preparandoTodo, setPreparandoTodo] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<any>(null);
  const [simulando, setSimulando] = useState(false);
  // Los faltantes de cada corte, según se piden: el renglón del corte los
  // enseña abiertos abajo, sin cambiar de pantalla.
  const [faltantes, setFaltantes] = useState<Record<number, any>>({});
  const [pidiendoFaltantes, setPidiendoFaltantes] = useState<number | null>(null);
  const [actualizando, setActualizando] = useState(false);

  /** Pide (o cierra) la lista de lo que quedó sin preparar en un corte. */
  async function verFaltantes(corteId: number) {
    if (faltantes[corteId]) {
      setFaltantes((f) => {
        const { [corteId]: _fuera, ...resto } = f;
        return resto;
      });
      return;
    }
    setPidiendoFaltantes(corteId);
    setError(null);
    try {
      const r = await fetch(`/api/tiktok/cortes/${corteId}/faltantes`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los faltantes.");
      setFaltantes((f) => ({ ...f, [corteId]: j }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPidiendoFaltantes(null);
    }
  }

  async function simular() {
    setSimulando(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes/simular");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo simular.");
      setSimulacion(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulando(false);
    }
  }

  /** Lo que se dice de un corte ya hecho. */
  function resumenDeCorte(j: any): string {
    // Sin corte guardado (nadie entró): el porqué va aquí mismo, agrupado,
    // porque no hay renglón en la lista que lo enseñe.
    if (j.corteId == null) {
      const grupos = agruparErrores(j.errores ?? []);
      const motivos = grupos.filter((g) => g.pedidos.length).map((g) => `${g.pedidos.length} ${g.pedidos.length === 1 ? "pedido" : "pedidos"}: ${g.ejemplo}`);
      return ["Ningún pedido entró al corte; no se guardó ninguno.", ...motivos].join(" ");
    }
    const partes = [`Corte #${j.numero}: ${j.pedidos} pedidos, ${j.pares} pares confirmados en TikTok.`];
    if (j.publicados) partes.push(`${j.publicados} SKU republicados.`);
    if (j.dropOff) partes.push(`${j.dropOff} salieron como entrega en paquetería.`);
    if (j.cancelados?.length) {
      const completos = j.cancelados.filter((c: any) => c.completo).length;
      partes.push(`Defensa: ${j.cancelados.length} renglones cancelados en TikTok (${j.cancelados.map((c: any) => `${c.sku} ×${c.pares}`).join(", ")})${completos ? `, ${completos} pedidos completos` : ""}.`);
    }
    const fuera = (j.errores ?? []).filter((e: any) => e.orderId).length;
    if (fuera) partes.push(`${fuera} pedidos no entraron (abajo el motivo).`);
    if (j.al3pl?.sinEndpoint) partes.push("Salidas al 3PL: Industher todavía no tiene el endpoint; se reintentan solas.");
    else if (j.al3pl?.error) partes.push(`Salidas al 3PL: ${j.al3pl.error}`);
    else if (j.al3pl?.confirmadas) partes.push(`${j.al3pl.confirmadas} salidas descontadas en Industher.`);
    return partes.join(" ");
  }

  /**
   * «Actualizar»: vuelve a leer en TikTok lo que sigue sin preparar en los
   * cortes que se ven y dice qué dejó de faltar. Los faltantes abiertos se
   * vuelven a pedir para que la lista de abajo también cambie.
   */
  async function actualizar() {
    setActualizando(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes/releer", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo actualizar.");
      const partes: string[] = [];
      if (!j.releidos) partes.push("No había pedidos sin preparar que releer.");
      else {
        partes.push(`Se releyeron ${j.releidos} pedidos de ${j.cortes} cortes.`);
        if (j.enviados?.length) partes.push(`${j.enviados.length} ya salieron sin escanearse: ${j.enviados.join(", ")}.`);
        if (j.cancelados?.length) partes.push(`${j.cancelados.length} se cancelaron: ${j.cancelados.join(", ")}.`);
        if (!j.enviados?.length && !j.cancelados?.length) partes.push("Nada cambió: lo que falta sigue faltando.");
      }
      for (const a of j.avisos ?? []) partes.push(String(a));
      setAviso(partes.join(" "));
      const abiertos = Object.keys(faltantes).map(Number);
      setFaltantes({});
      router.refresh();
      for (const id of abiertos) {
        const rf = await fetch(`/api/tiktok/cortes/${id}/faltantes`);
        if (rf.ok) {
          const jf = await rf.json();
          setFaltantes((f) => ({ ...f, [id]: jf }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActualizando(false);
    }
  }

  async function hacerCorte(modo?: "lunes") {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/cortes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handover, ...(modo ? { modo } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo hacer el corte.");
      if (j.modo === "lunes") {
        const partes = (j.cortes ?? []).map((c: any) => resumenDeCorte(c));
        if (j.aviso) partes.push(j.aviso);
        setAviso(partes.join(" · "));
      } else {
        setAviso(resumenDeCorte(j));
      }
      setSimulacion(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="tarjeta p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {pendientes ? `${pendientes} pedidos por despachar` : "Nada por despachar"}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              Hacer corte confirma todos los envíos en TikTok de un jalón, descuenta del almacén,
              republica y deja el corte guardado con sus etiquetas y su lista. Defensa automática: si un SKU
              no tiene stock físico para todos los pedidos que lo piden, se cancela en TikTok solo ese renglón
              (los pedidos más nuevos primero) y se confirma lo demás; si TikTok no acepta la cancelación, el
              pedido entero se queda fuera y se avisa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={handover}
              onChange={(e) => setHandover(e.target.value as "PICKUP" | "DROP_OFF")}
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)" }}
              aria-label="Cómo se entregan los paquetes"
            >
              <option value="PICKUP">Pasa el repartidor</option>
              <option value="DROP_OFF">Los llevo a la paquetería</option>
            </select>
            <button
              onClick={actualizar}
              disabled={actualizando}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--grid)" }}
              title="Vuelve a leer en TikTok lo que sigue sin preparar en los cortes recientes: lo que ya se envió o se canceló deja de faltar"
            >
              <RefreshCw size={14} className={actualizando ? "animate-spin" : undefined} />
              {actualizando ? "Leyendo TikTok…" : "Actualizar"}
            </button>
            <button
              onClick={simular}
              disabled={simulando || !pendientes}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--grid)" }}
              title="Ver qué haría el corte sin confirmar nada"
            >
              <Eye size={14} />
              {simulando ? "Simulando…" : "Simular"}
            </button>
            <button
              onClick={() => hacerCorte("lunes")}
              disabled={ocupado || !pendientes}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--grid)" }}
              title="Dos cortes: primero lo del viernes y el sábado (lo que ya casi cumple 48 horas) y luego lo del domingo y el lunes"
            >
              <CalendarClock size={14} />
              {ocupado ? "Confirmando…" : "Corte lunes"}
            </button>
            <button
              onClick={() => hacerCorte()}
              disabled={ocupado || !pendientes}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--acento)" }}
            >
              <Scissors size={14} />
              {ocupado ? "Confirmando en TikTok…" : `Hacer corte (${pendientes})`}
            </button>
          </div>
        </div>
        {aviso ? <p className="mt-2 text-xs" style={{ color: "var(--exito-texto)" }}>{aviso}</p> : null}
        {error ? <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}

        {simulacion ? (
          <div className="mt-4 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--grid)" }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Simulación: {simulacion.pedidos.length} pedidos · {simulacion.totalPares} pares
              </span>
              <button onClick={() => setSimulacion(null)} className="text-xs underline" style={{ color: "var(--ink-2)" }}>
                cerrar
              </button>
            </div>
            {simulacion.tandas && simulacion.tandas.urgentes && simulacion.tandas.resto ? (
              <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                Corte lunes: {simulacion.tandas.urgentes} pedidos de antes del {simulacion.tandas.corte} (viernes y
                sábado, los que ya casi cumplen 48 horas) en el primer corte y {simulacion.tandas.resto} del domingo y
                el lunes en el segundo.
              </p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-1">
              {simulacion.pedidos.map((p: any) => (
                <li key={p.orderId} className="flex flex-wrap items-center gap-2">
                  <span className="cifra text-xs" style={{ color: "var(--ink-2)" }}>{p.orderId}</span>
                  <span>{p.pares.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}</span>
                  {p.bloqueados?.length ? (
                    <span className="rounded-full px-2 text-[11px] font-semibold" style={{ background: "color-mix(in oklab, var(--estado-critico) 14%, transparent)", color: "var(--estado-critico)" }}>
                      se cancela: {p.bloqueados.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}
                    </span>
                  ) : null}
                  <span
                    className="rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      background: p.recoleccion === true ? "var(--acento-suave)" : p.recoleccion === false ? "color-mix(in oklab, var(--estado-alerta) 18%, transparent)" : "var(--grid)",
                      color: p.recoleccion === true ? "var(--exito-texto)" : "var(--ink-2)",
                    }}
                  >
                    {p.recoleccion === true ? "recolección disponible" : p.recoleccion === false ? "solo drop-off" : "sin dato"}
                  </span>
                  {p.aviso ? <span className="text-xs" style={{ color: "var(--ink-2)" }}>{p.aviso}</span> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
              Al 3PL se mandarían: {simulacion.salidasAl3pl.map((x: any) => `${x.sku} ×${x.pares}`).join(", ") || "nada"}
              {" · "}endpoint: {simulacion.endpoint3pl ?? "sin configurar"}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
              Nada de esto se ha confirmado. Es solo lo que pasaría. «Se cancela» es la defensa automática: ese SKU
              no tiene stock físico para todos los pedidos que lo piden, así que se cancela en TikTok solo ese
              renglón (los pedidos más nuevos primero) y se confirma lo demás.
            </p>
          </div>
        ) : null}
      </section>

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Cortes</h2>
        <p className="px-4 text-xs" style={{ color: "var(--ink-2)" }}>
          Surtido: pares por SKU en orden alfabético, para jalar de bodega. En los cortes nuevos,
          etiquetas y lista de empaque van PRIMERO con los paquetes de un solo modelo (una pieza o
          varias del mismo modelo) y al final los revueltos, y dentro de cada bloque en orden de
          modelo → color → talla, con el mismo número. Un corte ya hecho conserva el orden y los
          números con los que se imprimió. En la etiqueta va el CÓDIGO DEL PEDIDO en barras: escanearlo
          en la estación enseña qué empacar, y luego se escanea el FNSKU de cada caja. Si un corte
          quedó a medias, «Faltantes» dice qué pedidos y qué productos quedaron sin preparar.
        </p>
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--grid)" }}>
          {cortes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hairline">
              <div>
                <div className="text-sm font-semibold">
                  Corte #{c.numero}
                  <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
                    {cuando(c.creadoEn)} · {c.pedidos} pedidos · {c.pares} pares ·{" "}
                    {c.handover === "DROP_OFF" ? "a la paquetería" : "pasa el repartidor"}
                  </span>
                  <span
                    className="ml-2 rounded-full px-2 text-[11px] font-semibold"
                    style={{
                      background: listosDe(c) != null && (listosDe(c) as number) >= vivosDe(c) && vivosDe(c) > 0 ? "var(--acento-suave)" : "var(--grid)",
                      color: listosDe(c) != null && (listosDe(c) as number) >= vivosDe(c) && vivosDe(c) > 0 ? "var(--exito-texto)" : "var(--ink-2)",
                    }}
                  >
                    {listosDe(c) ?? "—"} / {vivosDe(c)} preparados
                    {c.enviados ? ` · ${c.enviados} ${c.enviados === 1 ? "ya enviado sin escanear" : "ya enviados sin escanear"}` : ""}
                    {c.cancelados ? ` · ${c.cancelados} ${c.cancelados === 1 ? "cancelado" : "cancelados"}` : ""}
                  </span>
                </div>
                {c.errores?.filter((e) => !e.error.includes("solo drop-off")).length ? (
                  <ul className="mt-1 text-xs" style={{ color: "var(--estado-critico)" }}>
                    {agruparErrores(c.errores.filter((e) => !e.error.includes("solo drop-off"))).map((g) => (
                      <li
                        key={g.mensaje}
                        title={g.pedidos.length > 1 ? g.ejemplo : undefined}
                        // Un renglón sin pedido es una nota del corte entero (por
                        // ejemplo, que salió como recolección sin horario): no es rojo.
                        style={g.pedidos.length ? undefined : { color: "var(--ink-2)" }}
                      >
                        {g.pedidos.length > 1
                          ? `${g.pedidos.length} pedidos: ${g.mensaje}`
                          : g.pedidos.length === 1
                            ? `Pedido ${g.pedidos[0]}: ${g.ejemplo}`
                            : g.ejemplo}
                        {g.pedidos.length > 1 ? (
                          <details className="inline">
                            <summary className="ml-1 inline cursor-pointer underline" style={{ color: "var(--ink-2)" }}>
                              ver cuáles
                            </summary>
                            <span className="cifra ml-1" style={{ color: "var(--ink-2)" }}>{g.pedidos.join(", ")}</span>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tiktok/despacho/${c.id}/preparar`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                >
                  <ScanLine size={14} /> Preparar pedidos
                </Link>
                {vivosDe(c) > 0 && listosDe(c) != null && (listosDe(c) as number) < vivosDe(c) ? (
                  <button
                    type="button"
                    disabled={pidiendoFaltantes === c.id}
                    onClick={() => verFaltantes(c.id)}
                    title="Los pedidos de este corte que todavía no se preparan, con sus productos"
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: "var(--estado-alerta)", color: "var(--ink-1)" }}
                  >
                    <PackageX size={14} />
                    {pidiendoFaltantes === c.id
                      ? "Buscando…"
                      : faltantes[c.id]
                        ? "Ocultar faltantes"
                        : `Faltantes (${vivosDe(c) - (listosDe(c) ?? 0)})`}
                  </button>
                ) : null}
                {vivosDe(c) > 0 && listosDe(c) != null && (listosDe(c) as number) < vivosDe(c) ? (
                  <button
                    type="button"
                    disabled={preparandoTodo === c.id}
                    onClick={async () => {
                      const faltan = vivosDe(c) - (listosDe(c) ?? 0);
                      const pin = window.prompt(
                        `Dar por preparado TODO el corte #${c.numero} sin escanear (faltan ${faltan}). Clave de supervisor:`,
                      );
                      if (pin == null) return;
                      setPreparandoTodo(c.id);
                      try {
                        const r = await fetch(`/api/tiktok/cortes/${c.id}/preparar-todo`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ pin }),
                        });
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error ?? "No se pudo.");
                        router.refresh();
                      } catch (e) {
                        alert((e as Error).message);
                      } finally {
                        setPreparandoTodo(null);
                      }
                    }}
                    title="Da por preparados todos los paquetes pendientes del corte, con constancia SUPERVISOR"
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }}
                  >
                    <ShieldCheck size={14} /> {preparandoTodo === c.id ? "Preparando…" : "Todo con clave"}
                  </button>
                ) : null}
                <a
                  href={`/api/tiktok/cortes/${c.id}/surtido`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--grid)" }}
                >
                  Lista de surtido
                </a>
                <a
                  href={`/api/tiktok/cortes/${c.id}/etiquetas`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                  style={{ background: "var(--acento)" }}
                >
                  <Printer size={14} /> Etiquetas PDF
                </a>
                <a
                  href={`/api/tiktok/cortes/${c.id}/salidas`}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--grid)" }}
                  title="Las salidas del corte para el 3PL (CSV)"
                >
                  Salidas 3PL
                </a>
                <a
                  href={`/api/tiktok/cortes/${c.id}/lista`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--grid)" }}
                >
                  <FileText size={14} /> Lista de empaque
                </a>
              </div>
              {faltantes[c.id] ? (
                <div className="w-full rounded-lg border p-3 text-sm" style={{ borderColor: "var(--grid)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      Faltan {faltantes[c.id].faltantes.length} de {faltantes[c.id].total} paquetes ·{" "}
                      {faltantes[c.id].pares.reduce((a: number, x: any) => a + x.pares, 0)} pares
                      {faltantes[c.id].enviados
                        ? ` · ${faltantes[c.id].enviados} ${faltantes[c.id].enviados === 1 ? "ya enviado sin escanear" : "ya enviados sin escanear"}`
                        : ""}
                      {faltantes[c.id].cancelados
                        ? ` · ${faltantes[c.id].cancelados} ${faltantes[c.id].cancelados === 1 ? "cancelado después del corte" : "cancelados después del corte"}`
                        : ""}
                    </span>
                    <a
                      href={`/api/tiktok/cortes/${c.id}/faltantes?formato=pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs underline"
                      style={{ color: "var(--ink-2)" }}
                    >
                      <Printer size={12} /> Imprimir la hoja
                    </a>
                  </div>
                  {faltantes[c.id].pares.length ? (
                    <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
                      Por surtir:{" "}
                      {faltantes[c.id].pares.map((x: any) => `${x.sku} ×${x.pares}`).join(" · ")}
                    </p>
                  ) : null}
                  <ul className="mt-2 flex flex-col gap-1">
                    {faltantes[c.id].faltantes.map((f: any) => (
                      <li key={`${f.orderId}-${f.packageId}`} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">#{f.numero}</span>
                        <span className="cifra text-xs" style={{ color: "var(--ink-2)" }}>
                          {f.orderId}
                        </span>
                        <span>
                          {f.pares.map((x: any) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ")}
                        </span>
                        {f.revuelto ? (
                          <span className="rounded-full px-2 text-[11px] font-semibold" style={{ background: "var(--grid)", color: "var(--ink-2)" }}>
                            revuelto
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {!faltantes[c.id].faltantes.length ? (
                      <li className="text-xs" style={{ color: "var(--ink-2)" }}>
                        Nada pendiente: el corte se preparó completo.
                      </li>
                    ) : null}
                  </ul>
                  {faltantes[c.id].rechazados?.length ? (
                    <div className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
                      Además, TikTok no aceptó estos pedidos al hacer el corte (nunca tuvieron guía):{" "}
                      {faltantes[c.id].rechazados.map((r: any) => r.orderId).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
          {!cortes.length ? (
            <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
              Todavía no hay cortes.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
