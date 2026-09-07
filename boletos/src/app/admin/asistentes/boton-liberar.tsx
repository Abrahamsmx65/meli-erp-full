"use client";

import { useTransition } from "react";
import { accionLiberarBoleto } from "../acciones";

export function BotonLiberar({ boletoId }: { boletoId: string }) {
  const [ocupado, empezar] = useTransition();
  return (
    <button
      className="boton boton-fantasma !px-2 !py-1 text-xs"
      disabled={ocupado}
      onClick={() => {
        if (confirm("¿Marcar este boleto como NO usado? Volverá a poder entrar.")) {
          empezar(async () => {
            await accionLiberarBoleto(boletoId);
          });
        }
      }}
    >
      Deshacer entrada
    </button>
  );
}
