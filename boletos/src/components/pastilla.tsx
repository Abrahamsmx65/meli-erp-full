import { ETIQUETA_ESTADO } from "@/lib/formato";

export function Pastilla({ estado }: { estado: string }) {
  return <span className={`pastilla pastilla-${estado}`}>{ETIQUETA_ESTADO[estado] ?? estado}</span>;
}
