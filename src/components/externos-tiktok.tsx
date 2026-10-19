"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Link2, Link2Off, Printer, Save, Search } from "lucide-react";
import { Ficha } from "./tiles";
import { Pestanas } from "./ui/pestanas";
import { Aviso, Seccion, Tabla } from "./ui/pagina";
import { coincidePublicacion, type PublicacionParaLigar } from "@/lib/tiktok/externos";
import type { RenglonStockExterno } from "@/lib/servicios/tiktok-externos";
import { confirmar } from "@/components/ui/confirmar";

const ESTADOS: Record<string, string> = {
  ACTIVATE: "activa",
  DEACTIVATE: "desactivada",
  DRAFT: "borrador",
  DELETED: "borrada",
  SELLER_DEACTIVATED: "desactivada por el vendedor",
  PLATFORM_DEACTIVATED: "desactivada por TikTok",
  FREEZE: "congelada",
};

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ExternosTikTok({
  vendedor,
  nombre,
  publicaciones,
  stock,
  pendientes,
  cortes,
}: {
  vendedor: string;
  nombre: string;
  publicaciones: PublicacionParaLigar[];
  stock: RenglonStockExterno[];
  pendientes: number;
  cortes: { id: number; numero: number; creadoEn: string; pedidos: number; pares: number }[];
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "bien" | "critico" | "alerta"; texto: string } | null>(null);
  // Lo que se está capturando: sku → pares tecleados (texto, para dejar vacío lo que no se toca).
  const [captura, setCaptura] = useState<Record<string, string>>({});

  const suyas = publicaciones.filter((p) => p.vendedor === vendedor);
  const visibles = useMemo(() => publicaciones.filter((p) => coincidePublicacion(p, busqueda)), [publicaciones, busqueda]);
  const sinContar = stock.filter((r) => !r.contado).length;
  const capturados = Object.entries(captura).filter(([, v]) => v.trim() !== "");

  async function llamar(cuerpo: Record<string, unknown>, clave: string): Promise<any> {
    setOcupado(clave);
    setAviso(null);
    try {
      const r = await fetch("/api/tiktok/externos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendedor, ...cuerpo }) });
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

  async function ligar(p: PublicacionParaLigar) {
    const j = await llamar({ accion: "ligar", productId: p.productId }, `ligar:${p.productId}`);
    if (!j) return;
    setAviso({
      tono: "bien",
      texto: `«${p.titulo}» ya es de ${nombre}: ${j.skus} variantes${j.bautizados ? ` (${j.bautizados} tomaron su SKU de TikTok como nombre en el kardex)` : ""}. Captura su stock en la pestaña Stock.`,
    });
    router.refresh();
  }

  async function desligar(p: PublicacionParaLigar) {
    if (!(await confirmar({ titulo: `¿Quitar «${p.titulo}» de ${nombre}?`, mensaje: "Vuelve a ser del dueño: Industher, el 3PL y las ventas la vuelven a contar.", confirmar: "Quitar", peligro: true }))) return;
    const j = await llamar({ accion: "desligar", productId: p.productId }, `desligar:${p.productId}`);
    if (!j) return;
    setAviso({ tono: "bien", texto: `«${p.titulo}» volvió a ser del dueño.` });
    router.refresh();
  }

  async function guardarStock() {
    const renglones = capturados.map(([sku, v]) => ({ sku, pares: Math.max(0, Math.round(Number(v) || 0)) }));
    if (!renglones.length) return;
    if (!(await confirmar({ titulo: `¿Guardar el stock de ${renglones.length} SKU?`, mensaje: "El kardex queda con ese número y se le escribe a TikTok ahora mismo.", confirmar: "Guardar stock" }))) return;
    const j = await llamar({ accion: "stock", renglones }, "stock");
    if (!j) return;
    const pub = j.publicacion;
    setAviso({
      tono: pub && "error" in pub ? "alerta" : "bien",
      texto:
        `${j.ajustes} SKU ajustados.` +
        (pub && "error" in pub
          ? ` TikTok no se pudo actualizar (${pub.error}); el cron lo reintenta en 15 minutos.`
          : pub
            ? ` TikTok actualizado: ${pub.publicados} SKU.${pub.avisos?.length ? ` ${pub.avisos.join(" ")}` : ""}`
            : " Nada cambió en TikTok."),
    });
    setCaptura({});
    router.refresh();
  }

  const panelStock = (
    <>
      {sinContar ? (
        <Aviso tono="alerta">
          {sinContar} SKU de {nombre} todavía no tienen stock capturado: TikTok se queda con el número que ya tenía hasta que se capture aquí (aunque sea cero).
        </Aviso>
      ) : null}
      <Seccion
        titulo="Stock por SKU"
        descripcion="Teclea lo que hay en la bodega (físico, con lo apartado adentro). Lo que se deja vacío no se toca."
        acciones={
          <button onClick={guardarStock} disabled={ocupado !== null || !capturados.length} className="boton boton-primario boton-chico">
            <Save size={14} />
            {ocupado === "stock" ? "Guardando…" : `Guardar stock${capturados.length ? ` (${capturados.length})` : ""}`}
          </button>
        }
        sinRelleno
      >
        <Tabla vacia={!stock.length} textoVacio={`Todavía no hay publicaciones ligadas a ${nombre}: liga una en la pestaña Publicaciones.`}>
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th className="num">En bodega</th>
                <th className="num">Apartado</th>
                <th className="num">Disponible</th>
                <th className="num">En TikTok</th>
                <th className="num">Nuevo stock</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((r) => (
                <tr key={r.sku}>
                  <td className="cifra text-xs">{r.sku}</td>
                  <td className="text-xs">
                    {r.titulo ?? ""}
                    {r.estado && r.estado !== "ACTIVATE" ? <span className="chip ml-2">{ESTADOS[r.estado] ?? r.estado}</span> : null}
                  </td>
                  <td className="num">{r.contado ? r.saldo : <span className="texto-tenue">sin capturar</span>}</td>
                  <td className="num">{r.apartado}</td>
                  <td className="num">{r.contado ? r.disponible : "—"}</td>
                  <td className="num">{r.enTikTok ?? "—"}</td>
                  <td className="num">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={captura[r.sku] ?? ""}
                      placeholder={r.contado ? String(r.saldo) : "0"}
                      onChange={(e) => setCaptura((c) => ({ ...c, [r.sku]: e.target.value }))}
                      className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </Seccion>
    </>
  );

  const panelPublicaciones = (
    <Seccion
      titulo="Publicaciones de la tienda"
      descripcion={`Marca cuáles son de ${nombre}. Las ligadas van primero.`}
      acciones={
        <label className="flex items-center gap-2">
          <Search size={14} className="texto-tenue" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por título o SKU…" className="w-64 rounded-lg border px-3 py-1.5 text-sm" />
        </label>
      }
      sinRelleno
    >
      <Tabla vacia={!visibles.length} textoVacio="Ninguna publicación coincide.">
        <table className="datos">
          <thead>
            <tr>
              <th>Publicación</th>
              <th>Estado</th>
              <th className="num">Variantes</th>
              <th>SKUs</th>
              <th>De quién</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.productId}>
                <td>
                  <div className="text-sm">{p.titulo}</div>
                  <div className="cifra text-xs texto-tenue">{p.productId}</div>
                </td>
                <td className="text-xs">{ESTADOS[p.estado] ?? p.estado}</td>
                <td className="num">{p.skus}</td>
                <td className="cifra text-xs texto-2">{p.sellerSkus.join(", ")}{p.skus > p.sellerSkus.length ? "…" : ""}</td>
                <td>
                  {p.vendedor ? (
                    <span className="chip" style={{ background: "var(--acento-suave)", color: "var(--acento)" }}>
                      {nombre}
                    </span>
                  ) : (
                    <span className="texto-tenue text-xs">GETAC</span>
                  )}
                </td>
                <td className="num">
                  {p.vendedor === vendedor ? (
                    <button onClick={() => desligar(p)} disabled={ocupado !== null} className="boton boton-borde boton-chico">
                      <Link2Off size={14} />
                      Quitar
                    </button>
                  ) : (
                    <button onClick={() => ligar(p)} disabled={ocupado !== null} className="boton boton-borde boton-chico">
                      <Link2 size={14} />
                      {ocupado === `ligar:${p.productId}` ? "Ligando…" : `Es de ${nombre}`}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tabla>
    </Seccion>
  );

  const panelCortes = (
    <Seccion
      titulo={`Cortes de ${nombre}`}
      descripcion="Sus pedidos (y los mixtos con algo de GETAC) se confirman y se imprimen en su propio despacho."
      acciones={
        <Link href={`/tiktok/despacho?vendedor=${vendedor}`} className="boton boton-primario boton-chico">
          <Printer size={14} />
          Abrir su despacho{pendientes ? ` (${pendientes} pendientes)` : ""}
        </Link>
      }
      sinRelleno
    >
      <Tabla vacia={!cortes.length} textoVacio={`${nombre} todavía no tiene cortes.`}>
        <table className="datos">
          <thead>
            <tr>
              <th>Corte</th>
              <th>Cuándo</th>
              <th className="num">Pedidos</th>
              <th className="num">Pares</th>
            </tr>
          </thead>
          <tbody>
            {cortes.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/tiktok/despacho?vendedor=${vendedor}`} className="enlace">
                    Corte #{c.numero}
                  </Link>
                </td>
                <td className="text-xs">{cuando(c.creadoEn)}</td>
                <td className="num">{c.pedidos}</td>
                <td className="num">{c.pares}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tabla>
    </Seccion>
  );

  return (
    <>
      <div className="cifras" style={{ ["--cifras-col" as string]: 4 }}>
        <Ficha titulo="Publicaciones ligadas" valor={suyas.length} nota={`de ${publicaciones.length} en la tienda`} />
        <Ficha titulo="SKU" valor={stock.length} nota={sinContar ? `${sinContar} sin stock capturado` : "todos con stock capturado"} tono={sinContar ? "alerta" : "neutro"} />
        <Ficha titulo="Pares disponibles" valor={stock.reduce((a, r) => a + (r.contado ? r.disponible : 0), 0)} nota={`${stock.reduce((a, r) => a + r.apartado, 0)} apartados en pedidos`} />
        <Ficha titulo="Pedidos por despachar" valor={pendientes} nota="van a su corte" tono={pendientes ? "alerta" : "neutro"} />
      </div>
      {aviso ? <Aviso tono={aviso.tono === "bien" ? "bien" : aviso.tono}>{aviso.texto}</Aviso> : null}
      <Pestanas
        pestanas={[
          { id: "stock", titulo: "Stock", cuenta: stock.length, alerta: sinContar > 0, contenido: panelStock },
          { id: "publicaciones", titulo: "Publicaciones", cuenta: suyas.length, contenido: panelPublicaciones },
          { id: "cortes", titulo: "Cortes", cuenta: pendientes || null, alerta: pendientes > 0, contenido: panelCortes },
        ]}
        inicial={stock.length ? "stock" : "publicaciones"}
      />
    </>
  );
}
