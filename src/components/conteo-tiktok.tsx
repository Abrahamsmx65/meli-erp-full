"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, ScanLine, Volume2, VolumeX } from "lucide-react";
import {
  ajustesDeConteo,
  escanearConteo,
  estadoInicialConteo,
  fijarConteo,
  fraseDeConteo,
  indexarParaConteo,
  modelosDeConteo,
  renglonesDeConteo,
  type EstadoConteo,
  type ProductoConteo,
} from "@/lib/tiktok/conteo";
import { hablar, pitar } from "./sonido-tiktok";

/**
 * La estación de conteo cíclico: el mismo escáner de preparar, pero sumando.
 * Cada escaneo del FNSKU es un par. La lógica vive en `conteo.ts`, probada
 * aparte; aquí solo se enseña, se corrige a mano y se guarda.
 */
export function ConteoTikTok({ productos, urlGuardar }: { productos: ProductoConteo[]; urlGuardar: string }) {
  const [estado, setEstado] = useState<EstadoConteo>(estadoInicialConteo());
  const [codigo, setCodigo] = useState("");
  const [modelo, setModelo] = useState<string>("");
  const [confirmaCeros, setConfirmaCeros] = useState(false);
  const [voz, setVoz] = useState(true);
  // En una tablet, el escáner teclea solo: el campo recibe el código sin que
  // haga falta el teclado en pantalla, que tapa todo. Se apaga con
  // inputMode="none" y se enciende solo cuando alguien quiere teclear.
  const [teclado, setTeclado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const indice = useMemo(() => indexarParaConteo(productos), [productos]);
  const modelos = useMemo(() => modelosDeConteo(productos), [productos]);
  const renglones = useMemo(() => renglonesDeConteo(estado, productos, modelo || null), [estado, productos, modelo]);
  const ajustes = useMemo(() => ajustesDeConteo(renglones, "ahora"), [renglones]);
  const ceros = renglones.filter((r) => r.supuestoCero);
  const sinFnsku = productos.filter((p) => !p.fnsku && (!modelo || p.sku.toUpperCase().startsWith(modelo.toUpperCase() + "-")));

  useEffect(() => {
    try {
      setVoz(localStorage.getItem("tiktok-voz") !== "no");
      window.speechSynthesis?.getVoices();
    } catch {
      /* la voz queda encendida */
    }
    input.current?.focus();
  }, []);

  function alternarVoz() {
    setVoz((v) => {
      try {
        localStorage.setItem("tiktok-voz", v ? "no" : "si");
      } catch {
        /* nada */
      }
      return !v;
    });
  }

  function escanear(valor: string) {
    setCodigo("");
    setResultado(null);
    const siguiente = escanearConteo(estado, valor, indice);
    if (siguiente.error) {
      pitar(false);
      if (voz) hablar("No lo conozco");
    } else {
      pitar(true, 1);
      if (voz && siguiente.ultimo) hablar(fraseDeConteo(siguiente.ultimo, siguiente.contados[siguiente.ultimo]));
    }
    setEstado(siguiente);
    input.current?.focus();
  }

  async function guardar() {
    if (!ajustes.length || guardando) return;
    if (ceros.length && !confirmaCeros) return;
    setGuardando(true);
    setResultado(null);
    try {
      const r = await fetch(urlGuardar, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renglones: renglones.map((x) => ({ sku: x.sku, contado: x.contado, saldo: x.saldo, supuestoCero: x.supuestoCero })),
          escaneos: estado.escaneos,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      const pub = j.publicacion;
      const textoPub = !pub
        ? "Nada que publicar."
        : "error" in pub
          ? `El kardex quedó bien, pero TikTok no recibió el cambio: ${pub.error}. El cron lo reintenta.`
          : `Publicado a TikTok: ${pub.publicados} SKU.${pub.avisos?.length ? " " + pub.avisos.join(" ") : ""}`;
      setResultado(`Conteo guardado: ${j.ajustes} ajuste${j.ajustes === 1 ? "" : "s"}. ${textoPub}`);
      if (voz) hablar("Conteo guardado");
      // Para el siguiente modelo se empieza en limpio, pero la pantalla se
      // queda para que se lea el resultado.
      setEstado(estadoInicialConteo());
      setConfirmaCeros(false);
      // El saldo que la pantalla conoce ya es viejo: se recarga.
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      pitar(false);
      setResultado((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const contados = Object.keys(estado.contados).length;
  const pares = Object.values(estado.contados).reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <section className="tarjeta p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Escanear</h2>
          <button
            type="button"
            onClick={alternarVoz}
            aria-pressed={voz}
            className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: "var(--grid)", color: voz ? "var(--acento)" : "var(--ink-2)" }}
          >
            {voz ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {voz ? "Voz" : "Sin voz"}
          </button>
        </div>

        <label className="mt-4 block text-xs" style={{ color: "var(--ink-2)" }}>
          Modelo que se cuenta completo (opcional)
          <select
            value={modelo}
            onChange={(e) => {
              setModelo(e.target.value);
              setConfirmaCeros(false);
            }}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--grid)" }}
          >
            <option value="">Solo lo que escanee</option>
            {modelos.map((m) => (
              <option key={m} value={m}>
                {m}: lo que no aparezca queda en 0
              </option>
            ))}
          </select>
        </label>

        <div
          className="mt-4 rounded-lg p-4"
          style={{ background: estado.error ? "color-mix(in oklab, var(--estado-critico) 12%, transparent)" : "var(--acento-suave)" }}
        >
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: "var(--ink-muted)" }}>
            Último
          </div>
          <p className="mt-1 text-base font-semibold" style={{ color: estado.error ? "var(--estado-critico)" : "var(--acento)" }}>
            {estado.error ?? (estado.ultimo ? `${estado.ultimo} · van ${estado.contados[estado.ultimo]}` : "Escanea el FNSKU de cada par.")}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            {contados} SKU · {pares} pares contados
          </p>
        </div>

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guardando) escanear(codigo);
          }}
        >
          <ScanLine size={18} style={{ color: "var(--ink-2)" }} />
          <input
            ref={input}
            value={codigo}
            inputMode={teclado ? "text" : "none"}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Escanea aquí (o teclea el SKU)"
            autoComplete="off"
            className="flex-1 rounded-lg border px-3 py-2 text-lg"
            style={{ borderColor: "var(--grid)" }}
          />
          <button type="submit" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--grid)" }}>
            Enter
          </button>
          <button
            type="button"
            onClick={() => {
              setTeclado((t) => !t);
              window.setTimeout(() => input.current?.focus(), 0);
            }}
            aria-pressed={teclado}
            title={teclado ? "Ocultar el teclado en pantalla" : "Teclear a mano"}
            className="rounded-lg border px-2 py-2 text-sm"
            style={{ borderColor: "var(--grid)", color: teclado ? "var(--acento)" : "var(--ink-2)" }}
          >
            <Keyboard size={16} />
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setEstado(estadoInicialConteo());
            setResultado(null);
            setConfirmaCeros(false);
          }}
          className="mt-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--grid)" }}
        >
          Empezar de cero
        </button>

        {sinFnsku.length ? (
          <div className="mt-4 text-xs" style={{ color: "var(--ink-2)" }}>
            <div className="font-semibold" style={{ color: "var(--estado-alerta)" }}>
              Sin FNSKU (se capturan a mano en la tabla): {sinFnsku.length}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {sinFnsku.slice(0, 40).map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  onClick={() => setEstado((e) => fijarConteo(e, p.sku, (e.contados[p.sku] ?? 0) + 1))}
                  className="rounded border px-1.5 py-0.5"
                  style={{ borderColor: "var(--grid)" }}
                  title="Suma un par a mano"
                >
                  {p.sku}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
          Cada escaneo suma un par. Los pares apartados (pedidos pagados sin despachar) siguen en
          la bodega: se cuentan y se comparan contra el saldo, no contra lo publicado.
        </p>
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4 hairline">
          <div>
            <h2 className="text-sm font-semibold">Contado vs kardex</h2>
            <p className="text-xs" style={{ color: "var(--ink-2)" }}>
              {ajustes.length === 0 ? "Todo cuadra." : `${ajustes.length} SKU con diferencia.`}
            </p>
          </div>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !ajustes.length || (ceros.length > 0 && !confirmaCeros)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--acento)" }}
          >
            {guardando ? "Guardando…" : "Guardar conteo y publicar a TikTok"}
          </button>
        </header>

        {ceros.length ? (
          <label className="flex items-start gap-2 px-4 py-3 text-sm" style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}>
            <input type="checkbox" checked={confirmaCeros} onChange={(e) => setConfirmaCeros(e.target.checked)} className="mt-1" />
            <span>
              {ceros.length} SKU de {modelo} con saldo NO aparecieron al escanear y quedarán en 0
              ({ceros.reduce((a, r) => a + r.saldo, 0)} pares). Confirmo que conté TODO el modelo.
            </span>
          </label>
        ) : null}

        {resultado ? (
          <p className="px-4 py-3 text-sm" style={{ color: resultado.startsWith("Conteo guardado") ? "var(--estado-bien)" : "var(--estado-critico)" }}>
            {resultado}
          </p>
        ) : null}

        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Kardex</th>
                <th className="num">Apartado</th>
                <th className="num">Contado</th>
                <th className="num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => (
                <tr key={r.sku} style={r.supuestoCero ? { color: "var(--estado-alerta)" } : undefined}>
                  <td>
                    <div className="font-medium">{r.sku}</div>
                    <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {r.fnsku ?? "sin FNSKU"}
                      {r.supuestoCero ? " · no apareció" : ""}
                    </div>
                  </td>
                  <td className="num cifra">{r.saldo}</td>
                  <td className="num cifra">{r.apartado}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      value={r.contado}
                      onChange={(e) => setEstado((s) => fijarConteo(s, r.sku, Number(e.target.value)))}
                      className="w-20 rounded border px-2 py-1 text-right"
                      style={{ borderColor: "var(--grid)" }}
                    />
                  </td>
                  <td
                    className="num cifra font-semibold"
                    style={{ color: r.diferencia === 0 ? "var(--estado-bien)" : r.diferencia < 0 ? "var(--estado-critico)" : "var(--estado-alerta)" }}
                  >
                    {r.diferencia > 0 ? `+${r.diferencia}` : r.diferencia}
                  </td>
                </tr>
              ))}
              {!renglones.length ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm" style={{ color: "var(--ink-2)" }}>
                    Todavía no hay nada contado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
