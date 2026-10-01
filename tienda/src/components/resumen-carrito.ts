"use client";

import { useEffect, useState } from "react";
import type { Renglon } from "./carrito";

export interface RenglonVivo {
  skuId: string;
  cantidad: number;
  titulo?: string;
  modelo?: string | null;
  color?: string | null;
  talla?: string | null;
  precio?: number;
  imagen?: string | null;
  disponible?: number;
  noDisponible?: boolean;
}

export interface Resumen {
  renglones: RenglonVivo[];
  subtotal: number;
  envio: number;
  regla: { costo: number; gratisDesde: number | null };
}

/** Pide al servidor precio y existencia de AHORITA para lo que hay en el carrito. */
export function useResumen(renglones: Renglon[]): { resumen: Resumen | null; cargando: boolean } {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const clave = JSON.stringify(renglones);
  useEffect(() => {
    const items = JSON.parse(clave) as Renglon[];
    if (!items.length) {
      setResumen({ renglones: [], subtotal: 0, envio: 0, regla: { costo: 0, gratisDesde: null } });
      return;
    }
    let vivo = true;
    setCargando(true);
    fetch("/api/carrito", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      .then((r) => r.json())
      .then((j) => vivo && setResumen(j))
      .catch(() => vivo && setResumen(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [clave]);
  return { resumen, cargando };
}
