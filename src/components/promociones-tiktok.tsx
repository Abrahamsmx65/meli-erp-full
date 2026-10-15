"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Power, RefreshCw, Repeat, Search, Trash2, Zap } from "lucide-react";
import { Ficha } from "./tiles";
import { Pestanas } from "./ui/pestanas";
import { Aviso, Seccion, Tabla } from "./ui/pagina";
import {
  HORAS_MAX_CICLICA,
  HORAS_POR_OMISION,
  MINUTOS_DE_ARRANQUE,
  VENTANAS_ADELANTE,
  nombreDeEstado,
  precioDeNivel,
  tituloDeOferta,
  type NivelOferta,
} from "@/lib/tiktok/promociones";
import type { CiclicaGuardada, ModeloParaOferta, OfertaGuardada, OfertasDeTikTok } from "@/lib/servicios/tiktok-promociones";

const NIVELES: { clave: NivelOferta; nombre: string; nota: string }[] = [
  { clave: "normal", nombre: "Relámpago normal", nota: "deja lo mismo que MELI" },
  { clave: "live", nombre: "Relámpago live", nota: "5 % abajo del normal" },
  { clave: "campana", nombre: "Campaña regular", nota: "5 % arriba del normal" },
];

function cuando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dinero(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** La fecha local de México para un <input type="datetime-local">: ahora + minutos, al minuto. */
function inicioPorOmision(ahora: number): string {
  const mx = new Date(ahora + MINUTOS_DE_ARRANQUE * 60_000 - 6 * 3_600_000);
  return mx.toISOString().slice(0, 16);
}

/** De "YYYY-MM-DDTHH:mm" en hora de México (UTC−6 fijo) a ISO. */
function isoDesdeMx(local: string): string | null {
  if (!local) return null;
  const t = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 6 * 3_600_000).toISOString();
}

function tonoEstado(estado: string): { background: string; color: string } {
  if (estado === "ONGOING") return { background: "var(--bien-suave)", color: "var(--exito-texto)" };
  if (estado === "NOT_START") return { background: "var(--acento-suave)", color: "var(--acento)" };
  if (estado === "DRAFT") return { background: "var(--alerta-suave)", color: "var(--alerta-texto)" };
  return { background: "var(--grid)", color: "var(--ink-2)" };
}

export function PromocionesTikTok({
  ofertas,
  modelos,
  avisos,
  guardadas,
  ciclicas,
  ahora,
}: {
  ofertas: OfertasDeTikTok;
  modelos: ModeloParaOferta[];
  avisos: string[];
  guardadas: OfertaGuardada[];
  ciclicas: CiclicaGuardada[];
  ahora: number;
}) {
  const router = useRouter();
  // Cíclicos: el formulario de alta y los precios editables por renglón.
  const [ciclicaModelo, setCiclicaModelo] = useState("");
  const [ciclicaPrecio, setCiclicaPrecio] = useState("");
  const [ciclicaHoras, setCiclicaHoras] = useState(String(HORAS_MAX_CICLICA));
  const [ciclicaTopeTalla, setCiclicaTopeTalla] = useState("");
  const [ciclicaTopeComprador, setCiclicaTopeComprador] = useState("");
  const [preciosCiclicas, setPreciosCiclicas] = useState<Record<number, string>>({});
  const [nivel, setNivel] = useState<NivelOferta>("normal");
  const [inicio, setInicio] = useState(() => inicioPorOmision(ahora));
  const [horas, setHoras] = useState(String(HORAS_POR_OMISION));
  const [titulo, setTitulo] = useState("");
  const [topePorTalla, setTopePorTalla] = useState("");
  const [topePorComprador, setTopePorComprador] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "bien" | "alerta" | "critico"; texto: string } | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? modelos.filter((m) => `${m.modelo} ${m.titulo ?? ""}`.toLowerCase().includes(q)) : modelos;
  }, [modelos, busqueda]);

  /** El precio con el que entra un modelo: el capturado o el del nivel. */
  const precioDe = (m: ModeloParaOferta): number | null => {
    const capturado = Number(precios[m.modelo]);
    if (capturado > 0) return capturado;
    return precioDeNivel(m.niveles ?? undefined, nivel);
  };
  const listos = modelos.filter((m) => marcados.has(m.modelo) && (precioDe(m) ?? 0) > 0);
  const sinPrecio = modelos.filter((m) => marcados.has(m.modelo) && !((precioDe(m) ?? 0) > 0));
  const variantes = listos.reduce((a, m) => a + m.skuIds.length, 0);
  const inicioIso = isoDesdeMx(inicio);
  const tituloSugerido = inicioIso ? tituloDeOferta(new Date(inicioIso), nivel) : "";

  async function llamar(cuerpo: Record<string, unknown>, clave: string): Promise<any> {
    setOcupado(clave);
    setAviso(null);
    try {
      const r = await fetch("/api/tiktok/promociones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "No se pudo.");
      return j;
    } catch (err) {
      setAviso({ tono: "critico", texto: (err as Error).message });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  function contarResultado(j: any): void {
    const partes = [`«${j.titulo}» creada en TikTok (${j.activityId}): ${j.modelos} modelos, ${j.variantes} variantes.`];
    if (j.errores?.length) partes.push(`TikTok rechazó: ${j.errores.join(" · ")}`);
    if (j.avisos?.length) partes.push(`TikTok avisa: ${j.avisos.join(" · ")}`);
    setAviso({ tono: j.errores?.length ? "alerta" : "bien", texto: partes.join(" ") });
  }

  async function crear() {
    if (!listos.length || !inicioIso) return;
    if (
      !window.confirm(
        `¿Crear la oferta relámpago en TikTok con ${listos.length} modelo${listos.length === 1 ? "" : "s"} (${variantes} variantes)? ` +
          `Empieza el ${cuando(inicioIso)} y dura ${horas} horas. El precio de oferta es el que ves en cada renglón.`,
      )
    )
      return;
    const j = await llamar(
      {
        accion: "crear",
        titulo: titulo.trim() || null,
        inicio: inicioIso,
        horas: Number(horas),
        nivel,
        topePorTalla: topePorTalla === "" ? -1 : Number(topePorTalla),
        topePorComprador: topePorComprador === "" ? -1 : Number(topePorComprador),
        modelos: listos.map((m) => ({ modelo: m.modelo, precio: precioDe(m) })),
      },
      "crear",
    );
    if (!j) return;
    contarResultado(j);
    setMarcados(new Set());
    router.refresh();
  }

  async function repetir(g: OfertaGuardada) {
    if (!window.confirm(`¿Repetir «${g.titulo}» con los mismos ${g.modelos.length} modelos y precios? Empieza en ${MINUTOS_DE_ARRANQUE} minutos.`)) return;
    const j = await llamar({ accion: "repetir", id: g.id }, `repetir:${g.id}`);
    if (!j) return;
    contarResultado(j);
    router.refresh();
  }

  async function desactivar(activityId: string, nombre: string) {
    if (!window.confirm(`¿Desactivar «${nombre}» en TikTok? Deja de enseñarse a los compradores en el acto.`)) return;
    const j = await llamar({ accion: "desactivar", activityId }, `desactivar:${activityId}`);
    if (!j) return;
    setAviso({ tono: "bien", texto: `«${nombre}» desactivada.` });
    router.refresh();
  }

  async function refrescar() {
    const j = await llamar({ accion: "refrescar" }, "refrescar");
    if (j) router.refresh();
  }

  function contarCiclica(c: CiclicaGuardada, verbo: string): void {
    const n = c.ventanas.length;
    const partes = [`${c.modelo} ${verbo} a ${dinero(c.precio)}: ${n} relámpago${n === 1 ? "" : "s"} programada${n === 1 ? "" : "s"}.`];
    if (c.ultimoError) partes.push(`TikTok: ${c.ultimoError}`);
    setAviso({ tono: c.ultimoError ? "alerta" : "bien", texto: partes.join(" ") });
  }

  async function guardarCiclica() {
    const modelo = ciclicaModelo.trim().toUpperCase();
    const precio = Number(ciclicaPrecio);
    if (!modelo || !(precio > 0)) return;
    const horas = Math.min(HORAS_MAX_CICLICA, Math.max(1, Number(ciclicaHoras) || HORAS_MAX_CICLICA));
    if (
      !window.confirm(
        `¿Volver cíclico el ${modelo} a ${dinero(precio)}? Desde ahora tendrá siempre ${VENTANAS_ADELANTE} relámpagos programadas en TikTok, ` +
          `una tras otra, de ${horas} horas cada una. La primera empieza en ${MINUTOS_DE_ARRANQUE} minutos.`,
      )
    )
      return;
    const j = await llamar(
      {
        accion: "ciclica-guardar",
        modelo,
        precio,
        horas,
        topePorTalla: ciclicaTopeTalla === "" ? -1 : Number(ciclicaTopeTalla),
        topePorComprador: ciclicaTopeComprador === "" ? -1 : Number(ciclicaTopeComprador),
      },
      "ciclica-guardar",
    );
    if (!j) return;
    contarCiclica(j.ciclica, "ya es cíclico");
    setCiclicaModelo("");
    setCiclicaPrecio("");
    router.refresh();
  }

  async function corregirCiclica(c: CiclicaGuardada) {
    const precio = Number(preciosCiclicas[c.id] ?? c.precio);
    if (!(precio > 0)) return;
    if (!window.confirm(`¿Cambiar el ${c.modelo} a ${dinero(precio)}? Se aplica a las relámpagos que aún no empiezan; la que corre termina con su precio.`)) return;
    const j = await llamar(
      { accion: "ciclica-guardar", modelo: c.modelo, precio, horas: c.horas, topePorTalla: c.topePorTalla, topePorComprador: c.topePorComprador },
      `ciclica:${c.id}`,
    );
    if (!j) return;
    contarCiclica(j.ciclica, "corregido");
    router.refresh();
  }

  async function quitarCiclica(c: CiclicaGuardada) {
    if (!window.confirm(`¿Quitar el ${c.modelo} de los cíclicos? Se desactivan en TikTok sus relámpagos que no han empezado; la que corre termina sola.`)) return;
    const j = await llamar({ accion: "ciclica-quitar", id: c.id }, `ciclica-quitar:${c.id}`);
    if (!j) return;
    setAviso({
      tono: j.errores?.length ? "alerta" : "bien",
      texto: `${c.modelo} ya no es cíclico: ${j.desactivadas} relámpagos desactivadas.${j.errores?.length ? ` TikTok no dejó: ${j.errores.join(" · ")}` : ""}`,
    });
    router.refresh();
  }

  async function programarCiclicas() {
    const j = await llamar({ accion: "ciclica-programar" }, "ciclica-programar");
    if (!j) return;
    setAviso({
      tono: j.errores?.length ? "alerta" : "bien",
      texto: `${j.revisadas} cíclicas revisadas, ${j.creadas} relámpagos creadas.${j.sinTiempo ? " Se acabó el tiempo: la siguiente hora sigue." : ""}${j.errores?.length ? ` ${j.errores.join(" · ")}` : ""}`,
    });
    router.refresh();
  }

  const guardadaPorActividad = new Map(guardadas.filter((g) => g.activityId).map((g) => [g.activityId as string, g]));
  const ciclicasActivas = ciclicas.filter((c) => c.activo);
  const yaCiclicos = new Set(ciclicasActivas.map((c) => c.modelo));
  const modeloCiclicaElegido = modelos.find((m) => m.modelo === ciclicaModelo.trim().toUpperCase());

  const panelCiclicos = (
    <>
      <Seccion
        titulo="Volver cíclico un modelo"
        descripcion={`El sistema le mantiene siempre ${VENTANAS_ADELANTE} relámpagos programadas, una tras otra, de hasta ${HORAS_MAX_CICLICA} horas cada una.`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs texto-tenue">Modelo</span>
            <input
              list="modelos-ciclicos"
              value={ciclicaModelo}
              onChange={(e) => setCiclicaModelo(e.target.value)}
              placeholder="GT148"
              className="w-32 rounded-lg border px-2 py-1 text-sm uppercase"
            />
            <datalist id="modelos-ciclicos">
              {modelos
                .filter((m) => !yaCiclicos.has(m.modelo))
                .map((m) => (
                  <option key={m.modelo} value={m.modelo}>
                    {m.titulo ?? m.productId}
                  </option>
                ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="block text-xs texto-tenue">Precio de oferta (MXN)</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={ciclicaPrecio}
              onChange={(e) => setCiclicaPrecio(e.target.value)}
              placeholder={modeloCiclicaElegido ? String(precioDeNivel(modeloCiclicaElegido.niveles ?? undefined, "normal") ?? "") : ""}
              className="w-28 rounded-lg border px-2 py-1 text-right text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs texto-tenue">Horas por relámpago (máx. {HORAS_MAX_CICLICA})</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={HORAS_MAX_CICLICA}
              value={ciclicaHoras}
              onChange={(e) => setCiclicaHoras(e.target.value)}
              className="w-20 rounded-lg border px-2 py-1 text-right text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs texto-tenue">Tope por talla</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={ciclicaTopeTalla}
              onChange={(e) => setCiclicaTopeTalla(e.target.value)}
              placeholder="sin tope"
              className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs texto-tenue">Tope por comprador</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={ciclicaTopeComprador}
              onChange={(e) => setCiclicaTopeComprador(e.target.value)}
              placeholder="sin tope"
              className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
            />
          </label>
          <button
            onClick={guardarCiclica}
            disabled={ocupado !== null || !modeloCiclicaElegido || !(Number(ciclicaPrecio) > 0)}
            className="boton boton-primario"
          >
            {ocupado === "ciclica-guardar" ? <Loader2 size={14} className="girando" /> : <Repeat size={14} />} Volver cíclico
          </button>
        </div>
        {modeloCiclicaElegido && modeloCiclicaElegido.niveles ? (
          <p className="mt-2 text-xs texto-tenue">
            Estrategia de precios del {modeloCiclicaElegido.modelo}: live {dinero(modeloCiclicaElegido.niveles.live)} · normal{" "}
            {dinero(modeloCiclicaElegido.niveles.normal)} · campaña {dinero(modeloCiclicaElegido.niveles.campana)}.
          </p>
        ) : null}
      </Seccion>
      <Seccion
        titulo="Modelos cíclicos"
        descripcion="Cada uno con sus relámpagos programadas en TikTok. El fondo repone cada hora la que falte."
        acciones={
          <button onClick={programarCiclicas} disabled={ocupado !== null || !ciclicasActivas.length} className="boton boton-borde boton-chico">
            {ocupado === "ciclica-programar" ? <Loader2 size={14} className="girando" /> : <RefreshCw size={14} />} Reponer ahora
          </button>
        }
      >
        {!ciclicas.length ? (
          <p className="py-6 text-center text-sm texto-tenue">Todavía no hay modelos cíclicos.</p>
        ) : (
          <Tabla>
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th className="num">Precio</th>
                  <th className="num">Horas</th>
                  <th>Relámpagos programadas</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ciclicas.map((c) => (
                  <tr key={c.id} style={!c.activo ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="text-sm font-semibold">{c.modelo}</div>
                      {!c.enTikTok ? <div className="text-xs" style={{ color: "var(--critico)" }}>sin producto activo en TikTok</div> : null}
                      {!c.activo ? <div className="text-xs texto-tenue">quitado</div> : null}
                    </td>
                    <td className="num">
                      {c.activo ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={1}
                            step={1}
                            value={preciosCiclicas[c.id] ?? String(c.precio)}
                            onChange={(e) => setPreciosCiclicas((p) => ({ ...p, [c.id]: e.target.value }))}
                            className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                          />
                          {preciosCiclicas[c.id] != null && Number(preciosCiclicas[c.id]) !== c.precio ? (
                            <button onClick={() => corregirCiclica(c)} disabled={ocupado !== null} className="boton boton-borde boton-chico">
                              {ocupado === `ciclica:${c.id}` ? <Loader2 size={14} className="girando" /> : null} Cambiar
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        dinero(c.precio)
                      )}
                    </td>
                    <td className="num">{c.horas}</td>
                    <td>
                      {c.ventanas.length ? (
                        <ul className="text-xs">
                          {c.ventanas.map((v) => (
                            <li key={v.id}>
                              {cuando(v.inicio)} → {cuando(v.fin)}
                              {Date.parse(v.inicio) <= ahora ? <span className="ml-1 texto-tenue">(en curso)</span> : null}
                              {v.estado === "parcial" ? <span className="ml-1" style={{ color: "var(--alerta-texto)" }}>(parcial)</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs texto-tenue">ninguna</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {c.ultimoError ? (
                        <span style={{ color: "var(--critico)" }}>{c.ultimoError}</span>
                      ) : c.programadoEn ? (
                        <span className="texto-tenue">revisado {cuando(c.programadoEn)}</span>
                      ) : (
                        <span className="texto-tenue">por programar</span>
                      )}
                    </td>
                    <td className="num">
                      {c.activo ? (
                        <button onClick={() => quitarCiclica(c)} disabled={ocupado !== null} className="boton boton-borde boton-chico" title="Quitar de los cíclicos">
                          {ocupado === `ciclica-quitar:${c.id}` ? <Loader2 size={14} className="girando" /> : <Trash2 size={14} />} Quitar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tabla>
        )}
      </Seccion>
    </>
  );
  const enCurso = ofertas.ofertas.filter((o) => o.estado === "ONGOING").length;
  const programadas = ofertas.ofertas.filter((o) => o.estado === "NOT_START").length;

  const panelOfertas = (
    <>
      {ofertas.error ? <Aviso tono="alerta">No se pudieron leer las ofertas de TikTok: {ofertas.error}</Aviso> : null}
      <Seccion
        titulo="Ofertas en TikTok"
        descripcion={`Lo que TikTok tiene hoy (leído ${cuando(ofertas.leidoEn)}).`}
        acciones={
          <button onClick={refrescar} disabled={ocupado !== null} className="boton boton-borde boton-chico">
            <RefreshCw size={14} className={ocupado === "refrescar" ? "animate-spin" : undefined} /> Releer TikTok
          </button>
        }
        sinRelleno
      >
        <Tabla vacia={!ofertas.ofertas.length} textoVacio="TikTok no tiene ofertas en curso ni programadas.">
          <table className="datos">
            <thead>
              <tr>
                <th>Oferta</th>
                <th>Estado</th>
                <th>Empieza</th>
                <th>Termina</th>
                <th className="num">Productos</th>
                <th>Creada desde el ERP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ofertas.ofertas.map((o) => {
                const g = guardadaPorActividad.get(o.activityId);
                return (
                  <tr key={o.activityId}>
                    <td>
                      <div className="text-sm">{o.titulo}</div>
                      <div className="cifra text-xs texto-tenue">
                        {o.activityId} · {o.tipo}
                        {o.nivelProducto ? ` · por ${o.nivelProducto === "VARIATION" ? "variante" : o.nivelProducto === "PRODUCT" ? "producto" : "tienda"}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className="chip" style={tonoEstado(o.estado)}>
                        {nombreDeEstado(o.estado)}
                      </span>
                    </td>
                    <td className="text-xs">{cuando(o.inicio)}</td>
                    <td className="text-xs">{cuando(o.fin)}</td>
                    <td className="num">{o.productos || "—"}</td>
                    <td className="text-xs texto-2">
                      {g ? `${g.modelos.length} modelos · ${g.modelos.map((m) => `${m.modelo} ${dinero(m.precio)}`).slice(0, 6).join(", ")}${g.modelos.length > 6 ? "…" : ""}` : "no"}
                    </td>
                    <td className="num">
                      <div className="flex justify-end gap-1">
                        {g ? (
                          <button onClick={() => repetir(g)} disabled={ocupado !== null} className="boton boton-borde boton-chico" title="La misma oferta otra vez, desde ahora">
                            <Repeat size={14} /> Repetir
                          </button>
                        ) : null}
                        {(o.estado === "ONGOING" || o.estado === "NOT_START" || o.estado === "DRAFT") && !o.inmutable ? (
                          <button onClick={() => desactivar(o.activityId, o.titulo)} disabled={ocupado !== null} className="boton boton-borde boton-chico">
                            <Power size={14} /> Desactivar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Tabla>
      </Seccion>
      {guardadas.length ? (
        <Seccion titulo="Creadas desde el ERP" descripcion="La constancia de cada oferta que se creó aquí, con lo que contestó TikTok." sinRelleno>
          <Tabla vacia={false}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Oferta</th>
                  <th>Nivel</th>
                  <th>Empieza</th>
                  <th>Modelos</th>
                  <th>Resultado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {guardadas.map((g) => (
                  <tr key={g.id}>
                    <td className="text-sm">
                      {g.titulo}
                      <div className="cifra text-xs texto-tenue">{g.activityId ?? "sin id"}</div>
                    </td>
                    <td className="text-xs">{NIVELES.find((n) => n.clave === g.nivel)?.nombre ?? g.nivel ?? "—"}</td>
                    <td className="text-xs">{cuando(g.inicio)}</td>
                    <td className="text-xs">{g.modelos.map((m) => `${m.modelo} ${dinero(m.precio)}`).join(", ")}</td>
                    <td className="text-xs" style={{ color: g.estado === "creada" || g.estado === "desactivada" ? "var(--ink-2)" : "var(--critico-texto)" }}>
                      {g.estado}
                      {g.error ? ` · ${g.error}` : ""}
                    </td>
                    <td className="num">
                      <button onClick={() => repetir(g)} disabled={ocupado !== null} className="boton boton-borde boton-chico">
                        <Repeat size={14} /> Repetir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tabla>
        </Seccion>
      ) : null}
    </>
  );

  const panelNueva = (
    <>
      {avisos.map((a) => (
        <Aviso key={a} tono="alerta">
          {a}
        </Aviso>
      ))}
      <Seccion titulo="Cómo va a ser" descripcion="Relámpago por variante: todas las tallas del modelo al mismo precio de oferta.">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-xs texto-2">
            Nivel de precio
            <select value={nivel} onChange={(e) => setNivel(e.target.value as NivelOferta)} className="rounded-lg border px-2 py-1.5 text-sm">
              {NIVELES.map((n) => (
                <option key={n.clave} value={n.clave}>
                  {n.nombre} · {n.nota}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs texto-2">
            Empieza (hora de México)
            <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col text-xs texto-2">
            Dura (horas)
            <input type="number" min={1} max={1440} value={horas} onChange={(e) => setHoras(e.target.value)} className="w-24 rounded-lg border px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col text-xs texto-2">
            Tope por talla (vacío = sin tope, máx. 99)
            <input type="number" min={1} max={99} value={topePorTalla} onChange={(e) => setTopePorTalla(e.target.value)} className="w-32 rounded-lg border px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col text-xs texto-2">
            Tope por comprador (vacío = sin tope)
            <input type="number" min={1} max={99} value={topePorComprador} onChange={(e) => setTopePorComprador(e.target.value)} className="w-32 rounded-lg border px-2 py-1.5 text-sm" />
          </label>
          <label className="flex min-w-72 flex-1 flex-col text-xs texto-2">
            Título en TikTok
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tituloSugerido} maxLength={50} className="rounded-lg border px-2 py-1.5 text-sm" />
          </label>
        </div>
      </Seccion>
      <Seccion
        titulo="Modelos"
        descripcion="Marca los que entran. El precio sugerido es el de Estrategia de precios en el nivel elegido; se puede corregir aquí."
        acciones={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2">
              <Search size={14} className="texto-tenue" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar modelo…" className="w-48 rounded-lg border px-3 py-1.5 text-sm" />
            </label>
            <button
              onClick={() => setMarcados(new Set(visibles.filter((m) => (precioDe(m) ?? 0) > 0).map((m) => m.modelo)))}
              className="boton boton-borde boton-chico"
              title="Marca todos los visibles que tienen precio"
            >
              Marcar con precio
            </button>
            <button onClick={() => setMarcados(new Set())} className="boton boton-borde boton-chico">
              Quitar todos
            </button>
            <button onClick={crear} disabled={ocupado !== null || !listos.length || !inicioIso} className="boton boton-primario boton-chico">
              {ocupado === "crear" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Crear en TikTok ({listos.length} modelos · {variantes} variantes)
            </button>
          </div>
        }
        sinRelleno
      >
        {sinPrecio.length ? (
          <Aviso tono="alerta" className="mx-4 mt-3">
            {sinPrecio.length} marcado{sinPrecio.length === 1 ? "" : "s"} sin precio ({sinPrecio.slice(0, 8).map((m) => m.modelo).join(", ")}
            {sinPrecio.length > 8 ? "…" : ""}): captura el precio o quítalos.
          </Aviso>
        ) : null}
        <Tabla vacia={!visibles.length} textoVacio="Ningún modelo activo en TikTok coincide.">
          <table className="datos">
            <thead>
              <tr>
                <th></th>
                <th>Modelo</th>
                <th className="num">Variantes</th>
                <th className="num">Lista TikTok</th>
                <th className="num">Live</th>
                <th className="num">Normal</th>
                <th className="num">Campaña</th>
                <th className="num">Precio de oferta</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((m) => {
                const sugerido = precioDeNivel(m.niveles ?? undefined, nivel);
                const marcado = marcados.has(m.modelo);
                return (
                  <tr key={m.modelo} style={{ opacity: marcado ? 1 : 0.8 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={(e) => {
                          const s = new Set(marcados);
                          if (e.target.checked) s.add(m.modelo);
                          else s.delete(m.modelo);
                          setMarcados(s);
                        }}
                      />
                    </td>
                    <td>
                      <div className="text-sm font-semibold">{m.modelo}</div>
                      <div className="line-clamp-1 text-xs texto-tenue" title={m.titulo ?? ""}>
                        {m.titulo ?? m.productId}
                      </div>
                    </td>
                    <td className="num">{m.skuIds.length}</td>
                    <td className="num">{dinero(m.precioLista)}</td>
                    <td className="num texto-2">{dinero(m.niveles?.live)}</td>
                    <td className="num texto-2">{dinero(m.niveles?.normal)}</td>
                    <td className="num texto-2">{dinero(m.niveles?.campana)}</td>
                    <td className="num">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        step={1}
                        value={precios[m.modelo] ?? ""}
                        placeholder={sugerido ? String(sugerido) : "sin precio"}
                        onChange={(e) => setPrecios((p) => ({ ...p, [m.modelo]: e.target.value }))}
                        className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{ borderColor: marcado && !((precioDe(m) ?? 0) > 0) ? "var(--critico)" : undefined }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Tabla>
      </Seccion>
    </>
  );

  return (
    <>
      <div className="cifras" style={{ ["--cifras-col" as string]: 4 }}>
        <Ficha titulo="En curso" valor={enCurso} nota="ofertas vivas en TikTok" tono={enCurso ? "bien" : "neutro"} />
        <Ficha titulo="Programadas" valor={programadas} nota="empiezan después" />
        <Ficha titulo="Modelos activos" valor={modelos.length} nota={`${modelos.filter((m) => m.niveles).length} con precio de la estrategia`} />
        <Ficha titulo="Creadas desde el ERP" valor={guardadas.length} nota="con constancia" />
      </div>
      {aviso ? <Aviso tono={aviso.tono}>{aviso.texto}</Aviso> : null}
      <Pestanas
        pestanas={[
          { id: "ofertas", titulo: "Ofertas", cuenta: ofertas.ofertas.length, contenido: panelOfertas },
          { id: "nueva", titulo: "Nueva relámpago", cuenta: marcados.size || null, contenido: panelNueva },
          { id: "ciclicos", titulo: "Cíclicos", cuenta: ciclicasActivas.length || null, contenido: panelCiclicos },
        ]}
      />
    </>
  );
}
