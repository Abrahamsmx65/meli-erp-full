"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * El carrito vive en el navegador (localStorage): solo guarda QUÉ variante y
 * CUÁNTOS. Precio y existencia se vuelven a preguntar al servidor siempre;
 * el apartado de verdad pasa hasta pagar.
 */
export interface Renglon {
  skuId: string;
  cantidad: number;
}

const LLAVE = "getac-carrito-v1";

interface Contexto {
  renglones: Renglon[];
  piezas: number;
  agregar: (skuId: string, cantidad: number) => void;
  fijar: (skuId: string, cantidad: number) => void;
  vaciar: () => void;
}

const Ctx = createContext<Contexto | null>(null);

function leer(): Renglon[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(LLAVE) ?? "[]");
    return Array.isArray(crudo) ? crudo.filter((r) => r && typeof r.skuId === "string" && r.cantidad > 0) : [];
  } catch {
    return [];
  }
}

export function CarritoProvider({ children }: { children: React.ReactNode }) {
  const [renglones, setRenglones] = useState<Renglon[]>([]);

  useEffect(() => {
    setRenglones(leer());
    const alCambiar = (e: StorageEvent) => e.key === LLAVE && setRenglones(leer());
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);

  const guardar = useCallback((nuevos: Renglon[]) => {
    setRenglones(nuevos);
    try {
      localStorage.setItem(LLAVE, JSON.stringify(nuevos));
    } catch {
      /* sin almacenamiento: el carrito dura lo que la pestaña */
    }
  }, []);

  const valor = useMemo<Contexto>(
    () => ({
      renglones,
      piezas: renglones.reduce((s, r) => s + r.cantidad, 0),
      agregar: (skuId, cantidad) => {
        const otros = renglones.filter((r) => r.skuId !== skuId);
        const previo = renglones.find((r) => r.skuId === skuId)?.cantidad ?? 0;
        guardar([...otros, { skuId, cantidad: Math.min(10, previo + cantidad) }]);
      },
      fijar: (skuId, cantidad) =>
        guardar(
          cantidad <= 0
            ? renglones.filter((r) => r.skuId !== skuId)
            : renglones.map((r) => (r.skuId === skuId ? { ...r, cantidad: Math.min(10, cantidad) } : r)),
        ),
      vaciar: () => guardar([]),
    }),
    [renglones, guardar],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useCarrito(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCarrito fuera de CarritoProvider");
  return c;
}
