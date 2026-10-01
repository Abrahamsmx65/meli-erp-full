"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { POCAS_PIEZAS, pesos, type ProductoVista } from "@/lib/tienda";
import { useCarrito } from "./carrito";

export function Ficha({ producto }: { producto: ProductoVista }) {
  const { agregar } = useCarrito();
  const [colorIdx, setColorIdx] = useState(0);
  const color = producto.colores[colorIdx];
  const [skuId, setSkuId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(false);

  const fotos = useMemo(() => {
    const lista = [...producto.imagenes];
    if (color?.imagen && !lista.includes(color.imagen)) lista.unshift(color.imagen);
    else if (color?.imagen) {
      lista.splice(lista.indexOf(color.imagen), 1);
      lista.unshift(color.imagen);
    }
    return lista;
  }, [producto.imagenes, color]);
  const [fotoIdx, setFotoIdx] = useState(0);
  const foto = fotos[Math.min(fotoIdx, fotos.length - 1)];

  const talla = color?.tallas.find((t) => t.skuId === skuId) ?? null;
  const precio = talla?.precio ?? Math.min(...(color?.tallas.map((t) => t.precio) ?? [0]));
  const lista = talla?.precioLista ?? null;
  const tope = Math.min(10, talla?.disponible ?? 0);

  function elegirColor(i: number) {
    setColorIdx(i);
    setSkuId(null);
    setFotoIdx(0);
    setAgregado(false);
  }

  return (
    <div className="ficha">
      <div>
        <div className="galeria-principal">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {foto && <img src={foto} alt={`${producto.titulo}${color ? `, color ${color.color}` : ""}`} />}
        </div>
        {fotos.length > 1 && (
          <div className="miniaturas" role="group" aria-label="Fotos">
            {fotos.map((f, i) => (
              <button key={f} aria-pressed={i === fotoIdx} onClick={() => setFotoIdx(i)} aria-label={`Foto ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ficha-info">
        <div>
          {producto.modelo && <div className="ficha-modelo modelo">{producto.modelo}</div>}
          <h1 className="ficha-titulo">{producto.titulo}</h1>
        </div>

        <div className="precio" style={{ fontSize: 26 }}>
          {pesos(precio)}
          {lista && <span className="precio-lista">{pesos(lista)}</span>}
        </div>

        {producto.colores.length > 1 && (
          <div>
            <div className="grupo-titulo">Color · {color?.color}</div>
            <div className="colores" role="group" aria-label="Color">
              {producto.colores.map((c, i) => (
                <button
                  key={c.color}
                  className={`color ${c.disponible <= 0 ? "color-agotado" : ""}`}
                  aria-pressed={i === colorIdx}
                  onClick={() => elegirColor(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.imagen ? <img src={c.imagen} alt="" /> : <span style={{ width: 8 }} />}
                  {c.color}
                  {c.disponible <= 0 && " · agotado"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="grupo-titulo">Talla (MX)</div>
          <div className="tallas" role="group" aria-label="Talla">
            {color?.tallas.map((t) => {
              const sin = t.disponible <= 0;
              return (
                <button
                  key={t.skuId}
                  className="etiqueta-caja"
                  disabled={sin}
                  aria-pressed={t.skuId === skuId}
                  aria-label={`Talla ${t.talla}${sin ? ", agotada" : t.disponible <= POCAS_PIEZAS ? `, quedan ${t.disponible}` : ""}`}
                  onClick={() => {
                    setSkuId(t.skuId);
                    setCantidad(1);
                    setAgregado(false);
                  }}
                >
                  <span className="num-talla">{t.talla}</span>
                  <span className={`pie ${!sin && t.disponible <= POCAS_PIEZAS ? "pocas" : ""}`}>
                    {sin ? "agotada" : t.disponible <= POCAS_PIEZAS ? `quedan ${t.disponible}` : "MX"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div className="cantidad" aria-label="Cantidad">
            <button onClick={() => setCantidad(Math.max(1, cantidad - 1))} aria-label="Uno menos" disabled={!talla}>
              −
            </button>
            <span aria-live="polite">{cantidad}</span>
            <button onClick={() => setCantidad(Math.min(tope, cantidad + 1))} aria-label="Uno más" disabled={!talla || cantidad >= tope}>
              +
            </button>
          </div>
          <button
            className="boton boton-comprar"
            style={{ flex: 1, minWidth: 200 }}
            disabled={!talla}
            onClick={() => {
              if (!talla) return;
              agregar(talla.skuId, cantidad);
              setAgregado(true);
            }}
          >
            {talla ? "Agregar al carrito" : "Elige tu talla"}
          </button>
        </div>

        {agregado && (
          <p className="nota nota-bien" role="status">
            Agregado. <Link href="/carrito">Ir al carrito</Link>
          </p>
        )}

        {producto.descripcion && (
          <div className="descripcion">
            <div className="grupo-titulo">Descripción</div>
            {producto.descripcion.split("\n").map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
