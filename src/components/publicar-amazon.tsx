"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  colorBase,
  faltantesDeAmazon,
  normalizarModelo,
  variantesDeAmazon,
  type AtributoSimple,
  type FichaAmazon,
  type PedidoAmazon,
} from "@/lib/amazon/publicar";
import { resumenDeVariantes, tallasDeTexto } from "@/lib/meli/publicar";
import { nombreColorEspanol } from "@/lib/tiktok/publicar";
import type { ModeloAmazon } from "@/lib/servicios/amazon-publicar";
import type { PublicacionGuardada } from "@/lib/servicios/meli-publicar";
import { Aviso, Seccion, Vacio } from "@/components/ui/pagina";

interface ColorForma {
  llave: number;
  codigo: string;
  nombre: string;
  nombreTocado: boolean;
}

interface Revision {
  ok: boolean;
  faltantes: string[];
  errores: string[];
  variantes: number;
  yaExisten: string[];
}

const CAMPO = "w-full rounded-lg border px-3 py-2 text-sm";
const TIPOS: Record<string, string> = { BOOT: "Botas", SANDAL: "Sandalias", SHOES: "Zapatos" };

let consecutivo = 1;
const colorVacio = (): ColorForma => ({ llave: consecutivo++, codigo: "", nombre: "", nombreTocado: false });

/** Crear un producto nuevo en Amazon: el padre y un hijo por color y talla, con la ficha copiada de otro modelo. */
export function PublicarAmazon({
  modelos,
  publicacionesIniciales,
  api = "/api/meli/publicar/amazon",
}: {
  modelos: ModeloAmazon[];
  publicacionesIniciales: PublicacionGuardada[];
  /** Base de las rutas: la de sesión o la del link con token. */
  api?: string;
}) {
  const [plantilla, setPlantilla] = useState(modelos[0]?.modelo ?? "");
  const [ficha, setFicha] = useState<FichaAmazon | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);

  const [modelo, setModelo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [precio, setPrecio] = useState("");
  const [colores, setColores] = useState<ColorForma[]>([colorVacio()]);
  const [textoTallas, setTextoTallas] = useState("");
  const [vinetas, setVinetas] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [palabras, setPalabras] = useState("");
  const [simples, setSimples] = useState<AtributoSimple[]>([]);

  const [revision, setRevision] = useState<Revision | null>(null);
  const [ocupado, setOcupado] = useState<"" | "validar" | "publicar">("");
  const [mensaje, setMensaje] = useState<{ tono: "bien" | "critico"; texto: string } | null>(null);
  const [publicaciones, setPublicaciones] = useState(publicacionesIniciales);

  // La ficha del modelo elegido, leída en vivo de Amazon. Los textos se
  // rellenan con los suyos: son el punto de partida para corregir.
  const pedida = useRef("");
  useEffect(() => {
    if (!plantilla) return;
    pedida.current = plantilla;
    setCargando(true);
    setErrorFicha(null);
    fetch(`${api}?ficha=${encodeURIComponent(plantilla)}`)
      .then(async (r) => {
        const j = await r.json();
        if (pedida.current !== plantilla) return;
        if (!r.ok) throw new Error(j.error ?? "No se pudo leer la ficha.");
        const f = j.ficha as FichaAmazon;
        setFicha(f);
        setSimples(f.simples);
        setVinetas(f.vinetas.join("\n"));
        setDescripcion(f.descripcion === "." ? "" : f.descripcion);
        setPalabras(f.palabras);
        setPrecio((p) => p || (f.precio != null ? String(f.precio) : ""));
      })
      .catch((e) => pedida.current === plantilla && setErrorFicha((e as Error).message))
      .finally(() => pedida.current === plantilla && setCargando(false));
  }, [plantilla, api]);

  const tallas = useMemo(() => tallasDeTexto(textoTallas).sort((a, b) => Number(a) - Number(b)), [textoTallas]);

  const pedido: PedidoAmazon | null = useMemo(() => {
    if (!ficha) return null;
    return {
      modelo: normalizarModelo(modelo),
      titulo: titulo.replace(/\s+/g, " ").trim(),
      precio: Number(precio) || 0,
      colores: colores.filter((c) => c.codigo.trim()).map((c) => ({ codigo: c.codigo.trim().toUpperCase(), nombre: c.nombre.trim() })),
      tallas,
      vinetas: vinetas.split("\n").map((v) => v.trim()).filter(Boolean),
      descripcion,
      palabras,
      simples,
      ficha,
    };
  }, [ficha, modelo, titulo, precio, colores, tallas, vinetas, descripcion, palabras, simples]);

  const faltantes = useMemo(() => (pedido ? faltantesDeAmazon(pedido) : []), [pedido]);
  const hijos = useMemo(() => (pedido ? variantesDeAmazon(pedido).filter((v) => !v.esPadre) : []), [pedido]);
  useEffect(() => setRevision(null), [pedido]);

  const cambiarColor = (llave: number, cambio: Partial<ColorForma>) =>
    setColores((cs) => cs.map((c) => (c.llave === llave ? { ...c, ...cambio } : c)));
  const escribirCodigo = (c: ColorForma, codigo: string) => {
    const esp = nombreColorEspanol(codigo);
    cambiarColor(c.llave, { codigo, ...(c.nombreTocado ? {} : { nombre: esp.traducido ? esp.nombre : "" }) });
  };

  const refrescar = useCallback(async () => {
    const r = await fetch(api).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    if (Array.isArray(j.publicaciones)) setPublicaciones(j.publicaciones);
  }, [api]);

  const enCurso = publicaciones.some((p) => p.estado === "publicando");
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(refrescar, 4000);
    return () => clearInterval(t);
  }, [enCurso, refrescar]);

  const mandar = async (accion: "validar" | "publicar") => {
    if (!pedido) return;
    setOcupado(accion);
    setMensaje(null);
    try {
      const r = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, ...pedido }),
      });
      const j = await r.json();
      if (accion === "validar" || (!r.ok && Array.isArray(j.errores))) {
        if (!r.ok && !Array.isArray(j.errores)) throw new Error(j.error ?? "No se pudo validar.");
        setRevision(j as Revision);
        return;
      }
      if (!r.ok) throw new Error(j.error ?? "No se pudo crear.");
      setMensaje({ tono: "bien", texto: `Creando ${pedido.modelo} en Amazon: el padre y ${hijos.length} variantes. El avance sale abajo.` });
      setPublicaciones((ps) => [
        { id: j.id, modelo: pedido.modelo, titulo: pedido.titulo, categoriaId: pedido.ficha.productType, precio: pedido.precio, estado: "publicando", error: null, variantes: [], creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString() },
        ...ps,
      ]);
      setModelo("");
      setColores([colorVacio()]);
      setTimeout(refrescar, 1500);
    } catch (e) {
      setMensaje({ tono: "critico", texto: (e as Error).message });
    } finally {
      setOcupado("");
    }
  };

  const retomar = async (id: string, accion: "continuar" | "reintentar") => {
    setPublicaciones((ps) => ps.map((p) => (p.id === id ? { ...p, estado: "publicando", error: null } : p)));
    await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, id }) }).catch(() => null);
    setTimeout(refrescar, 1500);
  };

  if (!modelos.length) return <Vacio>Amazon no tiene publicaciones de calzado para copiar su ficha.</Vacio>;

  return (
    <div className="flex flex-col gap-4">
      <Seccion titulo="Producto">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="texto-2">Modelo</span>
            <input className={`${CAMPO} uppercase`} placeholder="GT351" value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="texto-2">Precio</span>
            <input className={`${CAMPO} num`} inputMode="decimal" placeholder="999" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="texto-2">Copiar la ficha de</span>
            <select className={CAMPO} value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              {modelos.map((m) => (
                <option key={m.modelo} value={m.modelo}>
                  {m.modelo} · {m.titulo.replace(/^GETAC\s+/i, "").slice(0, 60)}
                </option>
              ))}
            </select>
            <span className="texto-tenue text-xs">
              {cargando ? "Leyendo la ficha en Amazon…" : ficha ? `Tipo de producto: ${TIPOS[ficha.productType] ?? ficha.productType}` : ""}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-4">
            <span className="texto-2">Título en Amazon</span>
            <textarea className={`${CAMPO} min-h-16`} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            <span className={`text-xs ${titulo.trim().length > 200 ? "text-red-700" : "texto-tenue"}`}>
              {titulo.trim().length} de 200{ficha?.titulo ? ` · el de ${ficha.modelo}: «${ficha.titulo.slice(0, 110)}…»` : ""}
            </span>
          </label>
        </div>
        {errorFicha ? (
          <Aviso tono="critico" className="mt-3">
            {errorFicha}
          </Aviso>
        ) : null}
      </Seccion>

      <Seccion
        titulo="Colores y tallas"
        descripcion="Se crean sin fotos, como las que se dan de alta a mano: Amazon las deja fuera de la búsqueda hasta que se suban."
        acciones={
          <button type="button" className="boton boton-chico" onClick={() => setColores((cs) => [...cs, colorVacio()])}>
            + Color
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {colores.map((c) => (
            <div key={c.llave} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="texto-2">Código (va en el SKU)</span>
                <input className={`${CAMPO} w-40 uppercase`} placeholder="BLK" value={c.codigo} onChange={(e) => escribirCodigo(c, e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="texto-2">Nombre para el cliente</span>
                <input className={`${CAMPO} w-48`} placeholder="Negro" value={c.nombre} onChange={(e) => cambiarColor(c.llave, { nombre: e.target.value, nombreTocado: true })} />
              </label>
              {c.nombre.trim() ? <span className="texto-tenue pb-2 text-xs">color base: {colorBase(c.nombre)}</span> : null}
              {colores.length > 1 ? (
                <button type="button" className="boton boton-chico boton-peligro" onClick={() => setColores((cs) => cs.filter((x) => x.llave !== c.llave))}>
                  Quitar
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="texto-2">Tallas: un rango (23-28) o sueltas (23, 24, 25.5)</span>
          <input className={`${CAMPO} max-w-md`} placeholder="23-28" value={textoTallas} onChange={(e) => setTextoTallas(e.target.value)} />
        </label>
        {tallas.length ? (
          <p className="mt-2 text-sm">
            <span className="cifra">{tallas.length}</span> tallas: <span className="num">{tallas.join(", ")}</span>
          </p>
        ) : null}
      </Seccion>

      {ficha ? (
        <Seccion titulo="Ficha" descripcion={`Ya viene llena con lo de ${ficha.modelo}: revisa y corrige lo que cambie.`}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="texto-2">Viñetas (una por renglón, hasta 5)</span>
            <textarea className={`${CAMPO} min-h-40`} value={vinetas} onChange={(e) => setVinetas(e.target.value)} />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-sm">
            <span className="texto-2">Descripción</span>
            <textarea className={`${CAMPO} min-h-20`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-sm">
            <span className="texto-2">Palabras de búsqueda</span>
            <input className={CAMPO} value={palabras} onChange={(e) => setPalabras(e.target.value)} />
          </label>
          <details className="mt-4" open>
            <summary className="cursor-pointer text-sm font-semibold">
              Atributos copiados: {simples.length} para revisar y {Object.keys(ficha.hijo).length - simples.length} que se copian tal cual
            </summary>
            <div className="mt-3 grid gap-x-4 gap-y-2 md:grid-cols-2">
              {simples.map((s) => (
                <label key={s.clave} className="flex flex-col gap-0.5 text-xs">
                  <span className="texto-2">{s.clave.replace(/_/g, " ")}</span>
                  <input
                    className={CAMPO}
                    value={s.valores.join(" | ")}
                    onChange={(e) =>
                      setSimples((ss) => ss.map((x) => (x.clave === s.clave ? { ...x, valores: e.target.value.split("|").map((v) => v.trim()) } : x)))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="texto-tenue mt-2 text-xs">Varios valores se separan con «|». Un campo vacío quita ese atributo.</p>
          </details>
        </Seccion>
      ) : null}

      <Seccion titulo="Crear en Amazon">
        {hijos.length ? (
          <p className="text-sm">
            El padre y <span className="cifra">{hijos.length}</span> variantes: {hijos.slice(0, 4).map((v) => v.sku).join(", ")}
            {hijos.length > 4 ? ` y ${hijos.length - 4} más` : ""}
          </p>
        ) : null}
        {faltantes.length ? (
          <Aviso tono="alerta" titulo="Falta" className="mt-3">
            <ul className="list-disc pl-4">
              {faltantes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Aviso>
        ) : null}
        {revision && !revision.faltantes.length ? (
          <Aviso tono={revision.ok ? "bien" : "critico"} titulo={revision.ok ? "Amazon lo acepta" : "Amazon lo rechaza"} className="mt-3">
            {revision.errores.length ? (
              <ul className="list-disc pl-4">
                {revision.errores.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {revision.yaExisten.length ? <p>Ya están en Amazon, no se repiten: {revision.yaExisten.join(", ")}.</p> : null}
          </Aviso>
        ) : null}
        {mensaje ? (
          <Aviso tono={mensaje.tono} className="mt-3">
            {mensaje.texto}
          </Aviso>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="boton" disabled={!pedido || !!faltantes.length || !!ocupado} onClick={() => mandar("validar")}>
            {ocupado === "validar" ? "Validando…" : "Validar con Amazon"}
          </button>
          <button type="button" className="boton boton-primario" disabled={!pedido || !!faltantes.length || !!ocupado || enCurso} onClick={() => mandar("publicar")}>
            {ocupado === "publicar" ? "Enviando…" : `Crear ${hijos.length || ""}`}
          </button>
        </div>
      </Seccion>

      <Seccion titulo="Creados desde aquí" sinRelleno>
        {publicaciones.length ? (
          <ul className="divide-y">
            {publicaciones.map((p) => {
              const r = resumenDeVariantes(p.variantes);
              const fallidas = p.variantes.filter((v) => v.estado === "error");
              return (
                <li key={p.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.modelo}</span>
                    <span className="texto-2">{p.titulo.slice(0, 70)}</span>
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {p.estado === "publicando" ? "Creando…" : p.estado === "publicado" ? "Creado" : p.estado === "parcial" ? "Incompleto" : p.estado === "error" ? "Con error" : "Pendiente"}
                    </span>
                    <span className="texto-tenue num text-xs">
                      {r.publicadas} de {r.total - r.yaExisten} (con el padre)
                      {r.yaExisten ? ` · ${r.yaExisten} ya existían` : ""}
                      {r.errores ? ` · ${r.errores} con error` : ""}
                    </span>
                    {p.estado !== "publicando" && r.pendientes ? (
                      <button type="button" className="boton boton-chico" onClick={() => retomar(p.id, "continuar")}>
                        Continuar
                      </button>
                    ) : null}
                    {p.estado !== "publicando" && r.errores ? (
                      <button type="button" className="boton boton-chico" onClick={() => retomar(p.id, "reintentar")}>
                        Reintentar las {r.errores}
                      </button>
                    ) : null}
                  </div>
                  {p.error ? <p className="mt-1 text-xs text-red-700">{p.error}</p> : null}
                  {fallidas.length ? (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-red-700">Ver errores</summary>
                      <ul className="mt-1 list-disc pl-4">
                        {fallidas.map((v) => (
                          <li key={v.sku}>
                            {v.sku}: {v.error}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4">
            <Vacio>Todavía no se ha creado nada en Amazon desde aquí.</Vacio>
          </div>
        )}
      </Seccion>
    </div>
  );
}
