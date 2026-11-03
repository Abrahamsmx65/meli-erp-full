"use client";

import { useMemo, useState } from "react";
import { Aviso, haceCuanto } from "@/components/ui/pagina";
import type { ProductoCatalogo } from "@/lib/tienda/catalogo-amazon";
import type { GuiaIA, GuiasGuardadas } from "@/lib/tienda/guia-ia";

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const usd = (x: number) => `$${x.toFixed(2)} USD`;
type Filtro = "todas" | "con" | "sin" | "editadas";

/** Una lista como texto: un renglón por elemento (los puntos fuertes, «punto | toma»). */
function aTexto(g: GuiaIA) {
  return {
    resumen: g.resumen,
    puntos: g.puntosFuertes.map((p) => (p.toma ? `${p.punto} | ${p.toma}` : p.punto)).join("\n"),
    ideas: g.ideas.join("\n"),
    ganchos: g.ganchos.join("\n"),
    paraQuien: g.paraQuien.join("\n"),
    evitar: g.evitar.join("\n"),
  };
}
type Borrador = ReturnType<typeof aTexto>;
const renglones = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
function deTexto(b: Borrador): GuiaIA {
  return {
    resumen: b.resumen.trim(),
    puntosFuertes: renglones(b.puntos).map((r) => {
      const [punto, ...toma] = r.split("|");
      return { punto: punto.trim(), toma: toma.join("|").trim() };
    }),
    ideas: renglones(b.ideas),
    ganchos: renglones(b.ganchos),
    paraQuien: renglones(b.paraQuien),
    evitar: renglones(b.evitar),
  };
}

const CAMPOS: { campo: keyof Borrador; titulo: string; ayuda?: string }[] = [
  { campo: "resumen", titulo: "Resumen" },
  { campo: "puntos", titulo: "Puntos fuertes", ayuda: "Uno por renglón: punto | toma para enseñarlo" },
  { campo: "ideas", titulo: "Ideas de video" },
  { campo: "ganchos", titulo: "Para los primeros 3 segundos" },
  { campo: "paraQuien", titulo: "Para quién" },
  { campo: "evitar", titulo: "Lo que no debe decir" },
];

/**
 * Las ideas para el video que hace Claude mirando las fotos (`servicios/guias-ia.ts`):
 * cuántas hay, lo gastado en el mes, y por modelo leerla, corregirla, rehacerla o quitarla.
 */
export function GuiasVideoBack({
  productos,
  inicial,
  hayLlave,
  tope,
}: {
  productos: ProductoCatalogo[];
  inicial: GuiasGuardadas;
  hayLlave: boolean;
  tope: number;
}) {
  const [datos, setDatos] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tono: "bien" | "alerta"; texto: string } | null>(null);

  const mes = new Date().toISOString().slice(0, 7);
  const gastoMes = datos.gasto[mes] ?? 0;
  const vivos = productos.filter((p) => !p.oculto);
  const conGuia = vivos.filter((p) => datos.guias[p.modelo]).length;
  const palabras = sinAcentos(busca).split(/[\s-]+/).filter(Boolean);
  const lista = useMemo(
    () =>
      vivos.filter((p) => {
        const g = datos.guias[p.modelo];
        if (filtro === "con" && !g) return false;
        if (filtro === "sin" && g) return false;
        if (filtro === "editadas" && !g?.editada) return false;
        const texto = sinAcentos(`${p.modelo} ${p.titulo} ${p.categoria}`);
        return palabras.every((w) => texto.includes(w));
      }),
    [vivos, datos, filtro, palabras],
  );

  async function recargar() {
    const r = await fetch("/api/tiktok/catalogo/guias", { cache: "no-store" });
    if (r.ok) setDatos(await r.json());
  }

  async function pedir(cuerpo: Record<string, unknown>, clave: string, exito: string) {
    setOcupado(clave);
    setMensaje(null);
    try {
      const r = await fetch("/api/tiktok/catalogo/guias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Error ${r.status}`);
      setMensaje({ tono: "bien", texto: exito });
      await recargar();
      return true;
    } catch (e) {
      setMensaje({ tono: "alerta", texto: (e as Error).message });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  function abrir(modelo: string) {
    if (abierto === modelo) {
      setAbierto(null);
      return;
    }
    const g = datos.guias[modelo];
    setAbierto(modelo);
    setBorrador(g ? aTexto(g) : null);
  }

  const corrida = datos.ultimaCorrida;
  return (
    <div className="space-y-3">
      {!hayLlave ? (
        <Aviso tono="alerta" titulo="Falta la llave de Anthropic">
          Agrega <code>ANTHROPIC_API_KEY_GUIAS</code> en Vercel (proyecto meli-erp-full). Mientras no esté, la página usa las ideas por categoría.
        </Aviso>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <b>{conGuia}</b> de {vivos.length} modelos con guía hecha por Claude
        </span>
        <span>
          Gastado este mes: <b>{usd(gastoMes)}</b> de {usd(tope)}
        </span>
        {corrida ? (
          <span className="texto-tenue">
            Última corrida {haceCuanto(corrida.en)}: {corrida.hechas.length} hechas
            {corrida.errores.length ? `, ${corrida.errores.length} con error` : ""}
            {corrida.motivo ? ` · ${corrida.motivo}` : ""}
          </span>
        ) : null}
        <button
          type="button"
          className="boton boton-primario"
          disabled={!hayLlave || ocupado === "generar"}
          onClick={() => pedir({ accion: "generar" }, "generar", "Se están haciendo por atrás; recarga en unos minutos para verlas.")}
        >
          {ocupado === "generar" ? "Mandando…" : "Hacer las que faltan"}
        </button>
        <button type="button" className="boton boton-borde" onClick={() => recargar()}>
          Actualizar
        </button>
      </div>
      {corrida?.errores.length ? (
        <Aviso tono="alerta" titulo="Errores de la última corrida">
          {corrida.errores.slice(0, 6).map((e) => (
            <div key={e.modelo}>
              {e.modelo}: {e.error}
            </div>
          ))}
        </Aviso>
      ) : null}
      {mensaje ? <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso> : null}

      <div className="flex flex-wrap items-end gap-3">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo…" className="w-56 rounded-lg border px-2 py-1.5 text-sm" />
        <div className="flex gap-1 text-sm">
          {(["todas", "con", "sin", "editadas"] as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={`rounded-lg border px-3 py-1.5 ${filtro === f ? "font-semibold" : ""}`}
              style={filtro === f ? { background: "var(--ink-1)", color: "var(--surface-1)" } : undefined}
            >
              {f === "todas" ? "Todas" : f === "con" ? "Con guía" : f === "sin" ? "Sin guía" : "Corregidas a mano"}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y rounded-lg border">
        {lista.map((p) => {
          const g = datos.guias[p.modelo];
          const abiertoAqui = abierto === p.modelo;
          return (
            <div key={p.modelo}>
              <button type="button" onClick={() => abrir(p.modelo)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.colores[0]?.fotos[0] ? <img src={p.colores[0].fotos[0]} alt="" loading="lazy" className="h-10 w-10 rounded border bg-white object-contain" /> : null}
                <span className="w-20 font-medium">{p.modelo}</span>
                <span className="min-w-0 flex-1 truncate text-xs texto-2">{g?.resumen || p.titulo}</span>
                <span className="text-xs texto-tenue">
                  {g ? (g.editada ? "corregida a mano" : `Claude · ${haceCuanto(g.generadoEn)}`) : "sin guía (usa reglas)"}
                </span>
              </button>
              {abiertoAqui ? (
                <div className="space-y-3 border-t px-3 py-3">
                  {borrador ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {CAMPOS.map(({ campo, titulo, ayuda }) => (
                        <label key={campo} className={`flex flex-col text-xs texto-2 ${campo === "resumen" || campo === "puntos" ? "md:col-span-2" : ""}`}>
                          <span className="font-semibold">{titulo}</span>
                          {ayuda ? <span className="texto-tenue">{ayuda}</span> : null}
                          <textarea
                            value={borrador[campo]}
                            onChange={(e) => setBorrador({ ...borrador, [campo]: e.target.value })}
                            rows={campo === "resumen" ? 2 : campo === "puntos" ? 6 : 4}
                            className="mt-1 rounded-lg border px-2 py-1.5 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm texto-2">Este modelo todavía no tiene guía de Claude; la página usa las ideas por categoría.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {borrador ? (
                      <button
                        type="button"
                        className="boton boton-primario"
                        disabled={ocupado === p.modelo}
                        onClick={() => pedir({ accion: "editar", modelo: p.modelo, guia: deTexto(borrador) }, p.modelo, `${p.modelo}: guardada. Ya no se rehace sola.`)}
                      >
                        Guardar cambios
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="boton boton-borde"
                      disabled={!hayLlave || ocupado === p.modelo}
                      onClick={() =>
                        pedir({ accion: "rehacer", modelo: p.modelo }, p.modelo, `${p.modelo}: Claude la está haciendo; en un minuto pícale a Actualizar.`)
                      }
                    >
                      {g ? "Rehacer con Claude" : "Hacer con Claude"}
                    </button>
                    {g ? (
                      <button
                        type="button"
                        className="boton boton-borde"
                        disabled={ocupado === p.modelo}
                        onClick={() => pedir({ accion: "quitar", modelo: p.modelo }, p.modelo, `${p.modelo}: guía quitada; la página vuelve a las ideas por categoría.`)}
                      >
                        Quitar
                      </button>
                    ) : null}
                    {g && !g.editada ? <span className="self-center text-xs texto-tenue">Costó {usd(g.costoUsd)}</span> : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
