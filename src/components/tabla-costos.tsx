"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PARAMETROS_COSTOS_OMISION,
  calcularCosto,
  type CostoCalculado,
  type FilaCosto,
  type Ganancia,
  type ParametrosCostos,
} from "@/lib/engine/costos";

/**
 * Costos de producto: la hoja "Numeros" en pantalla.
 *
 * Se captura lo que solo sabe el negocio (USD, TDC, CBM, envíos, precios) y
 * todo lo demás se recalcula al instante con el motor puro; cada renglón se
 * guarda solo al salir del campo, como en /productos. Las constantes de la
 * hoja van arriba, en su propia tarjeta, y al cambiarlas la tabla completa se
 * recalcula sin recargar.
 */

type Estado = "guardando" | "ok" | "error";

const pesos = (n: number | null | undefined, decimales = 2) =>
  n == null
    ? "—"
    : n.toLocaleString("es-MX", {
        style: "currency",
        currency: "MXN",
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
      });

const porcentaje = (n: number | null | undefined) =>
  n == null ? "" : `${(n * 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })} %`;

function colorGanancia(g: Ganancia | null): string {
  if (!g) return "var(--ink-muted)";
  if (g.ganancia < 0) return "var(--estado-critico)";
  if (g.porcentaje < 0.25) return "var(--estado-alerta)";
  return "var(--exito-texto)";
}

function CeldaGanancia({ g }: { g: Ganancia | null }) {
  return (
    <td className="num cifra whitespace-nowrap" style={{ color: colorGanancia(g) }}>
      {g ? (
        <>
          {pesos(g.ganancia)}
          <span className="ml-1 text-[11px]" style={{ opacity: 0.8 }}>
            {porcentaje(g.porcentaje)}
          </span>
        </>
      ) : (
        "—"
      )}
    </td>
  );
}

function Marca({ estado }: { estado?: Estado }) {
  if (!estado) return null;
  const texto = estado === "guardando" ? "…" : estado === "ok" ? "✓" : "✗";
  const color =
    estado === "error" ? "var(--estado-critico)" : estado === "ok" ? "var(--exito-texto)" : "var(--ink-muted)";
  return (
    <span className="text-xs" style={{ color }}>
      {texto}
    </span>
  );
}

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" } as const;

/** Campo numérico chico que guarda al salir. */
function Numero({
  valor,
  onCambio,
  onGuardar,
  placeholder,
  ancho = "w-20",
  paso = "0.01",
  deshabilitado,
}: {
  valor: number | null;
  onCambio: (v: number | null) => void;
  onGuardar: () => void;
  placeholder?: string;
  ancho?: string;
  paso?: string;
  deshabilitado?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step={paso}
      value={valor ?? ""}
      placeholder={placeholder ?? "—"}
      disabled={deshabilitado}
      onChange={(e) => onCambio(e.target.value === "" ? null : Number(e.target.value))}
      onBlur={onGuardar}
      className={`cifra ${ancho} rounded-lg border px-1.5 py-1 text-right text-sm`}
      style={estiloEntrada}
    />
  );
}

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------
interface CampoParametro {
  clave: keyof ParametrosCostos;
  texto: string;
  ayuda: string;
  /** Se captura como porcentaje (15) y se guarda como fracción (0.15). */
  porcentaje?: boolean;
}

const CAMPOS_PARAMETROS: CampoParametro[] = [
  { clave: "tdc", texto: "Tipo de cambio", ayuda: "MXN por USD, para los modelos sin el suyo" },
  { clave: "aduanaPorCbm", texto: "Aduana y flete por m³", ayuda: "Pesos por metro cúbico; se multiplica por el CBM de cada par" },
  { clave: "iva", texto: "IVA", ayuda: "Para sacar el precio sin IVA sobre el que va la retención", porcentaje: true },
  { clave: "retencion", texto: "Retención", ayuda: "Sobre el precio SIN IVA (ISR + IVA retenidos por la plataforma)", porcentaje: true },
  { clave: "meliComision", texto: "Comisión MELI", ayuda: "Sobre el precio de venta", porcentaje: true },
  { clave: "amazonComision", texto: "Comisión Amazon", ayuda: "Tarifa por referencia, sobre el precio", porcentaje: true },
  { clave: "amazonFactorDeal", texto: "Factor deal Amazon", ayuda: "El PVP se infla por esto para poder dar el deal (1.12 = 12 %)" },
  { clave: "tiktokComision", texto: "Comisión TikTok", ayuda: "De la plataforma, sin afiliados", porcentaje: true },
  { clave: "tiktokAfiliado", texto: "Afiliados TikTok", ayuda: "De omisión; cada modelo puede traer la suya", porcentaje: true },
  { clave: "tiktokEnvio", texto: "Envío TikTok", ayuda: "Pesos por par que cuesta el envío de TikTok" },
  { clave: "tiktokFactorOferta", texto: "Factor oferta TikTok", ayuda: "El precio se infla por esto para la oferta normal (1.06)" },
];

function Parametros({
  valor,
  onCambio,
  deshabilitado,
}: {
  valor: ParametrosCostos;
  onCambio: (p: ParametrosCostos) => void;
  deshabilitado: boolean;
}) {
  const [estado, setEstado] = useState<Estado | undefined>();
  const [borrador, setBorrador] = useState<Record<string, string>>(() => aTexto(valor));

  function aTexto(p: ParametrosCostos): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of CAMPOS_PARAMETROS) {
      const v = p[c.clave];
      out[c.clave] = c.porcentaje ? String(Math.round(v * 10000) / 100) : String(v);
    }
    return out;
  }

  async function guardar() {
    const nuevo: ParametrosCostos = { ...valor };
    for (const c of CAMPOS_PARAMETROS) {
      const n = Number(borrador[c.clave]);
      if (!Number.isFinite(n) || n < 0) continue;
      nuevo[c.clave] = c.porcentaje ? n / 100 : n;
    }
    onCambio(nuevo);
    setEstado("guardando");
    try {
      const r = await fetch("/api/costos/parametros", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nuevo),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo guardar.");
      setEstado("ok");
    } catch {
      setEstado("error");
    }
  }

  return (
    <section className="tarjeta p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Constantes de la hoja</h2>
        <span className="text-xs" style={{ color: "var(--ink-2)" }}>
          Se guardan al salir del campo y la tabla se recalcula al instante.
        </span>
        <Marca estado={estado} />
        <button
          type="button"
          className="boton boton-fantasma ml-auto !px-2 !py-1 text-xs"
          disabled={deshabilitado}
          onClick={() => {
            setBorrador(aTexto(PARAMETROS_COSTOS_OMISION));
            onCambio({ ...PARAMETROS_COSTOS_OMISION });
          }}
        >
          Volver a los de la hoja original
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {CAMPOS_PARAMETROS.map((c) => (
          <label key={c.clave} className="flex flex-col gap-1 text-xs" title={c.ayuda}>
            <span style={{ color: "var(--ink-2)" }}>
              {c.texto}
              {c.porcentaje ? " (%)" : ""}
            </span>
            <input
              type="number"
              min={0}
              step="any"
              value={borrador[c.clave] ?? ""}
              disabled={deshabilitado}
              onChange={(e) => setBorrador((b) => ({ ...b, [c.clave]: e.target.value }))}
              onBlur={() => void guardar()}
              className="cifra rounded-lg border px-2 py-1 text-right text-sm"
              style={estiloEntrada}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Importar desde la hoja
// ---------------------------------------------------------------------------
function ImportarHoja({ deshabilitado }: { deshabilitado: boolean }) {
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const subir = async (archivo: File) => {
    setSubiendo(true);
    setMensaje(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const r = await fetch("/api/costos/importar", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar.");
      setMensaje(`Listo: ${j.cargados} modelos cargados.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        className="boton boton-secundario cursor-pointer !py-1.5"
        style={{ opacity: subiendo || deshabilitado ? 0.6 : 1 }}
      >
        {subiendo ? "Cargando…" : "Cargar la hoja Numeros"}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          disabled={subiendo || deshabilitado}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
      </label>
      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
        Columnas: CATEGORIA · MODELO · USD · TDC · CBM X PAR · ENVIO · PRECIO RELAMPAGO · PV NORMAL ·
        ENVIO AMAZON (las calculadas se ignoran).
      </span>
      {mensaje ? (
        <span className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {mensaje}
        </span>
      ) : null}
      {error ? (
        <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------
type Filtro = "todos" | "sinCosto" | "sinPrecio" | "nuevos" | "negativos";

export function TablaCostos({
  filas: iniciales,
  parametros: parametrosIniciales,
  categorias,
  faltaMigracion,
}: {
  filas: FilaCosto[];
  parametros: ParametrosCostos;
  categorias: string[];
  faltaMigracion: boolean;
}) {
  const [filas, setFilas] = useState(iniciales);
  const [parametros, setParametros] = useState(parametrosIniciales);
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [nuevoModelo, setNuevoModelo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const calculadas = useMemo(
    () => new Map(filas.map((f) => [f.modelo, calcularCosto(f, parametros)] as [string, CostoCalculado])),
    [filas, parametros],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return filas.filter((f) => {
      const c = calculadas.get(f.modelo)!;
      if (filtro === "sinCosto" && c.costoTotal != null) return false;
      if (filtro === "sinPrecio" && (f.precioNormal || f.precioRelampago)) return false;
      if (filtro === "nuevos" && !f.esNuevo) return false;
      if (filtro === "negativos" && !(c.relampago && c.relampago.ganancia < 0) && !(c.normal && c.normal.ganancia < 0)) {
        return false;
      }
      if (!q) return true;
      return (
        f.modelo.includes(q) ||
        (f.categoria ?? "").toUpperCase().includes(q) ||
        (f.titulo ?? "").toUpperCase().includes(q)
      );
    });
  }, [filas, calculadas, busqueda, filtro]);

  const marcar = (modelo: string, e: Estado) => setEstado((s) => ({ ...s, [modelo]: e }));

  const actualizar = (modelo: string, cambios: Partial<FilaCosto>) =>
    setFilas((l) => l.map((f) => (f.modelo === modelo ? { ...f, ...cambios } : f)));

  /** Guarda el renglón completo: lo que cambió y lo demás igual. */
  async function guardar(modelo: string) {
    const f = filas.find((x) => x.modelo === modelo);
    if (!f) return;
    marcar(modelo, "guardando");
    setAviso(null);
    try {
      const r = await fetch("/api/costos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelo: f.modelo,
          categoria: f.categoria ?? "",
          costoUsd: f.costoUsd,
          tdc: f.tdc,
          cbmPar: f.cbmPar,
          envioMeli: f.envioMeli,
          precioRelampago: f.precioRelampago,
          precioNormal: f.precioNormal,
          envioAmazon: f.envioAmazon,
          precioAmazon: f.precioAmazon,
          afiliadoTiktok: f.afiliadoTiktok,
          precioTiktok: f.precioTiktok,
          notas: f.notas,
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo guardar.");
      marcar(modelo, "ok");
    } catch (err) {
      marcar(modelo, "error");
      setAviso((err as Error).message);
    }
  }

  function agregar() {
    const m = nuevoModelo.trim().toUpperCase();
    if (!m) return;
    if (filas.some((f) => f.modelo === m)) {
      setAviso(`${m} ya está en la lista.`);
      return;
    }
    const fila: FilaCosto = {
      modelo: m,
      categoria: null,
      costoUsd: null,
      tdc: null,
      cbmPar: null,
      envioMeli: null,
      precioRelampago: null,
      precioNormal: null,
      envioAmazon: null,
      precioAmazon: null,
      afiliadoTiktok: null,
      precioTiktok: null,
      notas: "",
      enCatalogo: false,
      esNuevo: false,
      titulo: null,
      actualizadoEn: null,
    };
    setFilas((l) => [fila, ...l]);
    setNuevoModelo("");
    setBusqueda(m);
  }

  async function quitar(modelo: string) {
    if (!window.confirm(`¿Quitar la captura de costos de ${modelo}?`)) return;
    try {
      const r = await fetch("/api/costos", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelo }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo quitar.");
      setFilas((l) => l.filter((f) => f.modelo !== modelo));
    } catch (err) {
      setAviso((err as Error).message);
    }
  }

  const conCosto = filas.filter((f) => calculadas.get(f.modelo)?.costoTotal != null).length;

  return (
    <div className="flex flex-col gap-6">
      <Parametros valor={parametros} onCambio={setParametros} deshabilitado={faltaMigracion} />

      <ImportarHoja deshabilitado={faltaMigracion} />

      {aviso ? (
        <div className="tarjeta p-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {aviso}
        </div>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo o categoría…"
            className="min-w-[14rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
            style={estiloEntrada}
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={estiloEntrada}
          >
            <option value="todos">Todos ({filas.length})</option>
            <option value="sinCosto">Sin costo ({filas.length - conCosto})</option>
            <option value="sinPrecio">Sin precio</option>
            <option value="nuevos">Modelos nuevos</option>
            <option value="negativos">Con pérdida</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={nuevoModelo}
              onChange={(e) => setNuevoModelo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") agregar();
              }}
              placeholder="Agregar modelo (GT280…)"
              disabled={faltaMigracion}
              className="w-44 rounded-lg border px-2 py-1.5 text-sm"
              style={estiloEntrada}
            />
            <button type="button" className="boton boton-primario !py-1.5" onClick={agregar} disabled={faltaMigracion}>
              Agregar
            </button>
          </div>
        </header>

        <div className="max-h-[42rem] overflow-auto">
          <table className="datos text-[13px]">
            <thead>
              <tr className="text-center">
                <th colSpan={2}></th>
                <th colSpan={5} style={{ borderLeft: "1px solid var(--borde)" }}>
                  Costo por par
                </th>
                <th colSpan={5} style={{ borderLeft: "1px solid var(--borde)" }}>
                  Mercado Libre
                </th>
                <th colSpan={5} style={{ borderLeft: "1px solid var(--borde)" }}>
                  Amazon
                </th>
                <th colSpan={5} style={{ borderLeft: "1px solid var(--borde)" }}>
                  TikTok Shop
                </th>
                <th colSpan={2}></th>
              </tr>
              <tr>
                <th>Modelo</th>
                <th>Categoría</th>
                <th className="num" style={{ borderLeft: "1px solid var(--borde)" }} title="Costo de fábrica por par, en dólares">
                  USD
                </th>
                <th className="num" title="Tipo de cambio; vacío = el de las constantes">TDC</th>
                <th className="num" title="Metros cúbicos que ocupa un par">CBM/par</th>
                <th className="num" title="Aduana y flete = pesos por m³ × CBM">Aduana</th>
                <th className="num" title="USD × TDC + aduana; se copia a Productos">Costo total</th>
                <th className="num" style={{ borderLeft: "1px solid var(--borde)" }} title="Costo de envío de MELI por par">
                  Envío
                </th>
                <th className="num">P. relámpago</th>
                <th className="num">Ganancia</th>
                <th className="num">PV normal</th>
                <th className="num">Ganancia</th>
                <th className="num" style={{ borderLeft: "1px solid var(--borde)" }} title="Tarifa FBA por par">
                  Envío
                </th>
                <th className="num" title="Precio con el que se gana lo mismo que el relámpago de MELI">PVP sin ads</th>
                <th className="num" title="PVP × factor deal">Para deal</th>
                <th className="num" title="El precio real publicado en Amazon">Precio real</th>
                <th className="num">Ganancia</th>
                <th className="num" style={{ borderLeft: "1px solid var(--borde)" }} title="Comisión de afiliados de este modelo">
                  Afiliado %
                </th>
                <th className="num" title="Precio con el que se gana lo mismo que el relámpago de MELI">Precio</th>
                <th className="num" title="Precio × factor oferta">En oferta</th>
                <th className="num" title="El precio real publicado en TikTok">Precio real</th>
                <th className="num">Ganancia</th>
                <th style={{ borderLeft: "1px solid var(--borde)" }}>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const c = calculadas.get(f.modelo)!;
                const st = estado[f.modelo];
                const guardarFila = () => void guardar(f.modelo);
                return (
                  <tr key={f.modelo}>
                    <td className="whitespace-nowrap font-medium">
                      {f.modelo}
                      {f.esNuevo ? (
                        <span className="chip ml-1" style={{ background: "var(--acento-suave)", color: "var(--acento)" }}>
                          nuevo
                        </span>
                      ) : null}
                      {!f.enCatalogo && !f.esNuevo ? (
                        <span className="ml-1 text-[11px]" style={{ color: "var(--ink-muted)" }} title="No está en el catálogo de MELI">
                          sin publicar
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        list="categorias-costos"
                        value={f.categoria ?? ""}
                        onChange={(e) => actualizar(f.modelo, { categoria: e.target.value })}
                        onBlur={guardarFila}
                        placeholder="EVA, CORCHO…"
                        disabled={faltaMigracion}
                        className="w-32 rounded-lg border px-1.5 py-1 text-sm"
                        style={estiloEntrada}
                      />
                    </td>
                    <td className="num" style={{ borderLeft: "1px solid var(--grid)" }}>
                      <Numero valor={f.costoUsd} onCambio={(v) => actualizar(f.modelo, { costoUsd: v })} onGuardar={guardarFila} paso="0.0001" deshabilitado={faltaMigracion} />
                    </td>
                    <td className="num">
                      <Numero valor={f.tdc} onCambio={(v) => actualizar(f.modelo, { tdc: v })} onGuardar={guardarFila} placeholder={String(parametros.tdc)} ancho="w-16" deshabilitado={faltaMigracion} />
                    </td>
                    <td className="num">
                      <Numero valor={f.cbmPar} onCambio={(v) => actualizar(f.modelo, { cbmPar: v })} onGuardar={guardarFila} paso="0.000001" ancho="w-24" deshabilitado={faltaMigracion} />
                    </td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>{pesos(c.aduana)}</td>
                    <td className="num cifra font-semibold">{pesos(c.costoTotal)}</td>
                    <td className="num" style={{ borderLeft: "1px solid var(--grid)" }}>
                      <Numero valor={f.envioMeli} onCambio={(v) => actualizar(f.modelo, { envioMeli: v })} onGuardar={guardarFila} ancho="w-16" deshabilitado={faltaMigracion} />
                    </td>
                    <td className="num">
                      <Numero valor={f.precioRelampago} onCambio={(v) => actualizar(f.modelo, { precioRelampago: v })} onGuardar={guardarFila} deshabilitado={faltaMigracion} />
                    </td>
                    <CeldaGanancia g={c.relampago} />
                    <td className="num">
                      <Numero valor={f.precioNormal} onCambio={(v) => actualizar(f.modelo, { precioNormal: v })} onGuardar={guardarFila} deshabilitado={faltaMigracion} />
                    </td>
                    <CeldaGanancia g={c.normal} />
                    <td className="num" style={{ borderLeft: "1px solid var(--grid)" }}>
                      <Numero valor={f.envioAmazon} onCambio={(v) => actualizar(f.modelo, { envioAmazon: v })} onGuardar={guardarFila} ancho="w-16" deshabilitado={faltaMigracion} />
                    </td>
                    <td className="num cifra">{pesos(c.pvpAmazon)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>{pesos(c.pvpAmazonDeal)}</td>
                    <td className="num">
                      <Numero valor={f.precioAmazon} onCambio={(v) => actualizar(f.modelo, { precioAmazon: v })} onGuardar={guardarFila} deshabilitado={faltaMigracion} />
                    </td>
                    <CeldaGanancia g={c.amazonReal} />
                    <td className="num" style={{ borderLeft: "1px solid var(--grid)" }}>
                      <Numero
                        valor={f.afiliadoTiktok == null ? null : Math.round(f.afiliadoTiktok * 10000) / 100}
                        onCambio={(v) => actualizar(f.modelo, { afiliadoTiktok: v == null ? null : v / 100 })}
                        onGuardar={guardarFila}
                        placeholder={String(Math.round(parametros.tiktokAfiliado * 10000) / 100)}
                        ancho="w-14"
                        paso="0.5"
                        deshabilitado={faltaMigracion}
                      />
                    </td>
                    <td className="num cifra">{pesos(c.precioTiktok)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>{pesos(c.precioTiktokOferta)}</td>
                    <td className="num">
                      <Numero valor={f.precioTiktok} onCambio={(v) => actualizar(f.modelo, { precioTiktok: v })} onGuardar={guardarFila} deshabilitado={faltaMigracion} />
                    </td>
                    <CeldaGanancia g={c.tiktokReal} />
                    <td style={{ borderLeft: "1px solid var(--grid)" }}>
                      <input
                        value={f.notas}
                        onChange={(e) => actualizar(f.modelo, { notas: e.target.value })}
                        onBlur={guardarFila}
                        placeholder="—"
                        disabled={faltaMigracion}
                        className="w-32 rounded-lg border px-1.5 py-1 text-sm"
                        style={estiloEntrada}
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      <Marca estado={st} />
                      {!f.enCatalogo ? (
                        <button
                          type="button"
                          className="ml-2 text-xs underline"
                          style={{ color: "var(--ink-muted)" }}
                          onClick={() => void quitar(f.modelo)}
                          title="Quitar la captura (no toca el catálogo)"
                        >
                          quitar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={24} className="py-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
                    Nada que mostrar con ese filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <datalist id="categorias-costos">
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
