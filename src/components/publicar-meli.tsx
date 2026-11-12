"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  faltantesDePedido,
  normalizarColor,
  normalizarModelo,
  resumenDeVariantes,
  tallasDeTexto,
  variantesDePedido,
  type AtributoFicha,
  type FichaPlantilla,
  type PedidoPublicacion,
} from "@/lib/meli/publicar";
import { nombreColorEspanol } from "@/lib/tiktok/publicar";
import type { CategoriaConModelos, PublicacionGuardada } from "@/lib/servicios/meli-publicar";
import { Aviso, Seccion, Vacio } from "@/components/ui/pagina";

interface Foto {
  id: string;
  url: string;
}

interface ColorForma {
  llave: number;
  codigo: string;
  nombre: string;
  /** El dueño ya escribió el nombre: no se pisa con la traducción. */
  nombreTocado: boolean;
  fotos: Foto[];
  subiendo: number;
  error: string | null;
}

interface Revision {
  ok: boolean;
  faltantes: string[];
  errores: string[];
  variantes: number;
  yaExisten: string[];
}

const LADO_MAXIMO = 1600;
const CAMPO = "w-full rounded-lg border px-3 py-2 text-sm";

/** Reduce la foto en el navegador (Vercel no acepta más de 4.5 MB por petición). */
async function reducirFoto(archivo: File): Promise<Blob> {
  try {
    const mapa = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
    if (escala === 1 && archivo.size < 3_500_000 && archivo.type === "image/jpeg") return archivo;
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(mapa.width * escala);
    lienzo.height = Math.round(mapa.height * escala);
    const ctx = lienzo.getContext("2d");
    if (!ctx) return archivo;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    return await new Promise<Blob>((ok) => lienzo.toBlob((b) => ok(b ?? archivo), "image/jpeg", 0.9));
  } catch {
    return archivo;
  }
}

let consecutivo = 1;
const colorVacio = (): ColorForma => ({
  llave: consecutivo++,
  codigo: "",
  nombre: "",
  nombreTocado: false,
  fotos: [],
  subiendo: 0,
  error: null,
});

export function PublicarMeli({
  categorias,
  publicacionesIniciales,
}: {
  categorias: CategoriaConModelos[];
  publicacionesIniciales: PublicacionGuardada[];
}) {
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? "");
  const categoria = categorias.find((c) => c.id === categoriaId);
  const [plantilla, setPlantilla] = useState(categorias[0]?.modelos[0] ?? "");
  const [ficha, setFicha] = useState<FichaPlantilla | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);

  const [modelo, setModelo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [precio, setPrecio] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [pausar, setPausar] = useState(true);
  const [colores, setColores] = useState<ColorForma[]>([colorVacio()]);
  const [tallas, setTallas] = useState<string[]>([]);
  const [textoTallas, setTextoTallas] = useState("");

  const [revision, setRevision] = useState<Revision | null>(null);
  const [ocupado, setOcupado] = useState<"" | "validar" | "publicar">("");
  const [mensaje, setMensaje] = useState<{ tono: "bien" | "critico"; texto: string } | null>(null);
  const [publicaciones, setPublicaciones] = useState(publicacionesIniciales);

  // La ficha del modelo elegido, leída en vivo de MELI.
  const pedida = useRef("");
  useEffect(() => {
    if (!plantilla) return;
    pedida.current = plantilla;
    setCargandoFicha(true);
    setErrorFicha(null);
    fetch(`/api/meli/publicar?ficha=${encodeURIComponent(plantilla)}`)
      .then(async (r) => {
        const j = await r.json();
        if (pedida.current !== plantilla) return;
        if (!r.ok) throw new Error(j.error ?? "No se pudo leer la ficha.");
        const f = j.ficha as FichaPlantilla;
        setFicha(f);
        setDescripcion((d) => d || f.descripcion);
        setPrecio((p) => p || (f.precio != null ? String(f.precio) : ""));
      })
      .catch((e) => pedida.current === plantilla && setErrorFicha((e as Error).message))
      .finally(() => pedida.current === plantilla && setCargandoFicha(false));
  }, [plantilla]);

  const cambiarCategoria = (id: string) => {
    setCategoriaId(id);
    setFicha(null);
    setPlantilla(categorias.find((c) => c.id === id)?.modelos[0] ?? "");
  };

  const pedido: PedidoPublicacion | null = useMemo(() => {
    if (!ficha) return null;
    return {
      modelo: normalizarModelo(modelo),
      titulo: titulo.replace(/\s+/g, " ").trim(),
      precio: Number(precio) || 0,
      descripcion,
      pausar,
      colores: colores
        .filter((c) => c.codigo.trim() || c.fotos.length)
        .map((c) => ({ codigo: normalizarColor(c.codigo), nombre: c.nombre.trim(), fotos: c.fotos.map((f) => f.id) })),
      tallas,
      ficha,
    };
  }, [ficha, modelo, titulo, precio, descripcion, pausar, colores, tallas]);

  const faltantes = useMemo(() => (pedido ? faltantesDePedido(pedido) : []), [pedido]);
  const variantes = useMemo(() => (pedido ? variantesDePedido(pedido) : []), [pedido]);
  const subiendo = colores.some((c) => c.subiendo > 0);

  // Cualquier cambio deja vieja la revisión de MELI.
  useEffect(() => setRevision(null), [pedido]);

  const cambiarColor = (llave: number, cambio: Partial<ColorForma>) =>
    setColores((cs) => cs.map((c) => (c.llave === llave ? { ...c, ...cambio } : c)));

  const escribirCodigo = (c: ColorForma, codigo: string) => {
    const esp = nombreColorEspanol(codigo);
    cambiarColor(c.llave, { codigo, ...(c.nombreTocado ? {} : { nombre: esp.traducido ? esp.nombre : "" }) });
  };

  const subirFotos = async (llave: number, archivos: FileList | null) => {
    if (!archivos?.length) return;
    const lista = [...archivos];
    setColores((cs) => cs.map((c) => (c.llave === llave ? { ...c, subiendo: c.subiendo + lista.length, error: null } : c)));
    for (const archivo of lista) {
      try {
        const forma = new FormData();
        forma.append("file", await reducirFoto(archivo), archivo.name.replace(/\.\w+$/, "") + ".jpg");
        const r = await fetch("/api/meli/publicar/foto", { method: "POST", body: forma });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo subir.");
        const foto: Foto = { id: j.id, url: j.url ?? URL.createObjectURL(archivo) };
        setColores((cs) => cs.map((c) => (c.llave === llave ? { ...c, fotos: [...c.fotos, foto].slice(0, 10), subiendo: c.subiendo - 1 } : c)));
      } catch (e) {
        setColores((cs) =>
          cs.map((c) => (c.llave === llave ? { ...c, subiendo: c.subiendo - 1, error: `${archivo.name}: ${(e as Error).message}` } : c)),
        );
      }
    }
  };

  const moverFoto = (llave: number, i: number) =>
    setColores((cs) =>
      cs.map((c) => (c.llave === llave ? { ...c, fotos: [c.fotos[i], ...c.fotos.filter((_, k) => k !== i)] } : c)),
    );

  const cambiarAtributo = (id: string, cambio: Partial<AtributoFicha>) =>
    setFicha((f) => (f ? { ...f, atributos: f.atributos.map((a) => (a.id === id ? { ...a, ...cambio } : a)) } : f));

  const refrescar = useCallback(async () => {
    const r = await fetch("/api/meli/publicar").catch(() => null);
    if (!r?.ok) return;
    const j = await r.json();
    if (Array.isArray(j.publicaciones)) setPublicaciones(j.publicaciones);
  }, []);

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
      const r = await fetch("/api/meli/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, ...pedido }),
      });
      const j = await r.json();
      if (accion === "validar" || (!r.ok && Array.isArray(j.errores))) {
        setRevision(j as Revision);
        if (!r.ok && !Array.isArray(j.errores)) throw new Error(j.error ?? "No se pudo validar.");
        return;
      }
      if (!r.ok) throw new Error(j.error ?? "No se pudo publicar.");
      setMensaje({ tono: "bien", texto: `Publicando ${pedido.modelo}: ${variantes.length} publicaciones. El avance sale abajo.` });
      setModelo("");
      setTitulo("");
      setColores([colorVacio()]);
      setTimeout(refrescar, 1500);
      setPublicaciones((ps) => [
        { id: j.id, modelo: pedido.modelo, titulo: pedido.titulo, categoriaId: pedido.ficha.categoriaId, precio: pedido.precio, estado: "publicando", error: null, variantes: [], creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString() },
        ...ps,
      ]);
    } catch (e) {
      setMensaje({ tono: "critico", texto: (e as Error).message });
    } finally {
      setOcupado("");
    }
  };

  const retomar = async (id: string, accion: "continuar" | "reintentar") => {
    setPublicaciones((ps) => ps.map((p) => (p.id === id ? { ...p, estado: "publicando", error: null } : p)));
    await fetch("/api/meli/publicar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, id }),
    }).catch(() => null);
    setTimeout(refrescar, 1500);
  };

  if (!categorias.length) return <Vacio>No hay publicaciones de calzado en el catálogo para copiar su ficha.</Vacio>;

  const maxTitulo = ficha?.maxTitulo ?? 60;

  return (
    <div className="flex flex-col gap-4">
      <Seccion titulo="Producto">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="texto-2">Modelo</span>
            <input className={`${CAMPO} uppercase`} placeholder="GT331" value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="texto-2">
              Título <span className="texto-tenue">(sin color ni talla: MELI los agrega)</span>
            </span>
            <input className={CAMPO} value={titulo} maxLength={maxTitulo + 20} onChange={(e) => setTitulo(e.target.value)} />
            <span className={`text-xs ${titulo.trim().length > maxTitulo ? "text-red-700" : "texto-tenue"}`}>
              {titulo.trim().length} de {maxTitulo}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="texto-2">Precio de lista</span>
            <input className={`${CAMPO} num`} inputMode="decimal" placeholder="999" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="texto-2">Categoría de MELI</span>
            <select className={CAMPO} value={categoriaId} onChange={(e) => cambiarCategoria(e.target.value)}>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.modelos.length} modelos
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="texto-2">Copiar la ficha de</span>
            <select className={CAMPO} value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              {(categoria?.modelos ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="texto-tenue text-xs">
              {cargandoFicha
                ? "Leyendo la ficha en MELI…"
                : ficha
                  ? `${ficha.titulo} · guía: ${ficha.guiaNombre || ficha.gridId || "sin guía"}`
                  : ""}
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
        titulo="Colores"
        descripcion={
          ficha?.fotos.length
            ? `De mientras llevan las ${ficha.fotos.length} fotos de ${ficha.modelo}; las propias se cambian después en MELI o se suben aquí.`
            : undefined
        }
        acciones={
          <button type="button" className="boton boton-chico" onClick={() => setColores((cs) => [...cs, colorVacio()])}>
            + Color
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          {colores.map((c) => (
            <div key={c.llave} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="texto-2">Código (va en el SKU)</span>
                  <input className={`${CAMPO} w-40 uppercase`} placeholder="BLK" value={c.codigo} onChange={(e) => escribirCodigo(c, e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="texto-2">Nombre para el cliente</span>
                  <input
                    className={`${CAMPO} w-48`}
                    placeholder="Negro"
                    value={c.nombre}
                    onChange={(e) => cambiarColor(c.llave, { nombre: e.target.value, nombreTocado: true })}
                  />
                </label>
                <label className="boton boton-chico cursor-pointer">
                  {c.subiendo ? `Subiendo ${c.subiendo}…` : "Fotos propias (opcional)"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void subirFotos(c.llave, e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                {colores.length > 1 ? (
                  <button type="button" className="boton boton-chico boton-peligro" onClick={() => setColores((cs) => cs.filter((x) => x.llave !== c.llave))}>
                    Quitar
                  </button>
                ) : null}
              </div>
              {c.fotos.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.fotos.map((f, i) => (
                    <div key={f.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt="" className="h-20 w-20 rounded-md border object-cover" />
                      {i === 0 ? (
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white">Portada</span>
                      ) : (
                        <button type="button" className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px]" onClick={() => moverFoto(c.llave, i)}>
                          Portada
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Quitar foto"
                        className="absolute right-1 top-1 rounded bg-white/90 px-1 text-[11px]"
                        onClick={() => cambiarColor(c.llave, { fotos: c.fotos.filter((x) => x.id !== f.id) })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : ficha?.fotos.length ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 opacity-70">
                  {ficha.fotos.slice(0, 6).map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={f.id} src={f.url} alt="" className="h-12 w-12 rounded-md border object-cover" />
                  ))}
                  <span className="texto-tenue text-xs">fotos de {ficha.modelo}, de mientras</span>
                </div>
              ) : null}
              {c.error ? <p className="mt-2 text-xs text-red-700">{c.error}</p> : null}
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Tallas">
        <label className="flex flex-col gap-1 text-sm">
          <span className="texto-2">Escribe las tallas: un rango (23-28) o sueltas (23, 24, 25.5)</span>
          <input
            className={`${CAMPO} max-w-md`}
            placeholder="23-28"
            value={textoTallas}
            onChange={(e) => {
              setTextoTallas(e.target.value);
              setTallas(tallasDeTexto(e.target.value).sort((a, b) => Number(a) - Number(b)));
            }}
          />
        </label>
        {tallas.length ? (
          <p className="mt-2 text-sm">
            <span className="cifra">{tallas.length}</span> tallas: <span className="num">{tallas.join(", ")}</span>
          </p>
        ) : null}
        {ficha?.filas.length ? (
          <p className="texto-tenue mt-1 text-xs">
            MELI acepta en esta categoría («{ficha.guiaNombre || "guía de tallas"}») de la {ficha.filas[0].talla} a la{" "}
            {ficha.filas[ficha.filas.length - 1].talla}.
          </p>
        ) : null}
      </Seccion>

      {ficha ? (
        <Seccion titulo="Ficha y descripción" descripcion="Ya viene llena con lo de la publicación copiada: revisa y corrige lo que cambie.">
          <details open>
            <summary className="cursor-pointer text-sm font-semibold">
              Ficha copiada de {ficha.modelo}: {ficha.atributos.length} atributos
              {ficha.atributos.some((a) => a.requerido && !a.valor.trim()) ? <span className="ml-2 text-red-700">· falta llenar</span> : null}
            </summary>
            <div className="mt-3 grid gap-x-4 gap-y-2 md:grid-cols-2">
              {ficha.atributos.map((a) => (
                <label key={a.id} className="flex flex-col gap-0.5 text-xs">
                  <span className="texto-2">
                    {a.nombre}
                    {a.requerido ? " *" : ""}
                  </span>
                  {a.opciones.length ? (
                    <select
                      className={CAMPO}
                      value={a.valorId ?? ""}
                      onChange={(e) => {
                        const o = a.opciones.find((x) => x.id === e.target.value);
                        cambiarAtributo(a.id, e.target.value === "-1" ? { valorId: "-1", valor: "No aplica" } : { valorId: o?.id ?? null, valor: o?.nombre ?? "" });
                      }}
                    >
                      <option value="">—</option>
                      {a.valorId && a.valorId !== "-1" && !a.opciones.some((o) => o.id === a.valorId) ? <option value={a.valorId}>{a.valor}</option> : null}
                      {a.opciones.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nombre}
                        </option>
                      ))}
                      {!a.requerido ? <option value="-1">No aplica</option> : null}
                    </select>
                  ) : (
                    <input
                      className={CAMPO}
                      value={a.valorId === "-1" ? "" : a.valor}
                      placeholder={a.valorId === "-1" ? "No aplica" : ""}
                      onChange={(e) => cambiarAtributo(a.id, { valor: e.target.value, valorId: null })}
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="texto-2">Descripción</span>
            <textarea className={`${CAMPO} min-h-40`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
        </Seccion>
      ) : null}

      <Seccion titulo="Publicar">
        {variantes.length ? (
          <p className="text-sm">
            <span className="cifra">{variantes.length}</span> publicaciones: {variantes.slice(0, 4).map((v) => v.sku).join(", ")}
            {variantes.length > 4 ? ` y ${variantes.length - 4} más` : ""}
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
          <Aviso tono={revision.ok ? "bien" : "critico"} titulo={revision.ok ? "MELI lo acepta" : "MELI lo rechaza"} className="mt-3">
            {revision.errores.length ? (
              <ul className="list-disc pl-4">
                {revision.errores.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {revision.yaExisten.length ? <p>Ya publicados, no se repiten: {revision.yaExisten.join(", ")}.</p> : null}
          </Aviso>
        ) : null}
        {mensaje ? (
          <Aviso tono={mensaje.tono} className="mt-3">
            {mensaje.texto}
          </Aviso>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pausar} onChange={(e) => setPausar(e.target.checked)} />
            Crearlas pausadas
          </label>
          <button type="button" className="boton" disabled={!pedido || !!faltantes.length || !!ocupado || subiendo} onClick={() => mandar("validar")}>
            {ocupado === "validar" ? "Validando…" : "Validar con MELI"}
          </button>
          <button
            type="button"
            className="boton boton-primario"
            disabled={!pedido || !!faltantes.length || !!ocupado || subiendo || enCurso}
            onClick={() => mandar("publicar")}
          >
            {ocupado === "publicar" ? "Enviando…" : `Publicar ${variantes.length || ""}`}
          </button>
        </div>
      </Seccion>

      <Seccion titulo="Publicados desde aquí" sinRelleno>
        {publicaciones.length ? (
          <ul className="divide-y">
            {publicaciones.map((p) => {
              const r = resumenDeVariantes(p.variantes);
              const fallidas = p.variantes.filter((v) => v.estado === "error");
              const avisos = p.variantes.filter((v) => v.aviso);
              return (
                <li key={p.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.modelo}</span>
                    <span className="texto-2">{p.titulo}</span>
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {p.estado === "publicando" ? "Publicando…" : p.estado === "publicado" ? "Publicado" : p.estado === "parcial" ? "Incompleto" : p.estado === "error" ? "Con error" : "Pendiente"}
                    </span>
                    <span className="texto-tenue num text-xs">
                      {r.publicadas} de {r.total - r.yaExisten}
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
                  {avisos.length ? (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer">Avisos ({avisos.length})</summary>
                      <ul className="mt-1 list-disc pl-4">
                        {avisos.map((v) => (
                          <li key={v.sku}>
                            {v.sku}: {v.aviso}
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
            <Vacio>Todavía no se ha publicado nada desde aquí.</Vacio>
          </div>
        )}
      </Seccion>
    </div>
  );
}
