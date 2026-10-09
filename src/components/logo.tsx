import Link from "next/link";
import { Package } from "lucide-react";

/** La marca: va sobre el azul marino (riel del menú y pantallas sin sesión). */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="GETAC, inicio">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: "var(--acento)", color: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,.25)" }}
      >
        <Package size={18} strokeWidth={2.5} />
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-extrabold tracking-tight" style={{ color: "var(--marca-texto)" }}>
          GETAC
        </span>
        <span
          className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "rgba(255,255,255,.6)" }}
        >
          Control de inventario
        </span>
      </span>
    </Link>
  );
}
