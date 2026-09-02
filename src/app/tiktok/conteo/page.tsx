import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { catalogoParaConteo } from "@/lib/servicios/tiktok-conteo";
import { ConteoTikTok } from "@/components/conteo-tiktok";

export const dynamic = "force-dynamic";

/** Conteo cíclico del almacén de TikTok, con sesión. */
export default async function Conteo() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <p className="text-sm">Conecta tu cuenta en Ajustes.</p>;

  const productos = await catalogoParaConteo(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Conteo cíclico · Almacén TikTok</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Escanea el FNSKU de cada par. Al guardar, la diferencia entra al kardex como ajuste y
            el disponible nuevo se publica a TikTok en el mismo clic.
          </p>
        </div>
        <Link href="/tiktok" className="text-sm underline" style={{ color: "var(--ink-2)" }}>
          ← Almacén TikTok
        </Link>
      </div>
      <ConteoTikTok productos={productos} urlGuardar="/api/tiktok/conteo" />
    </div>
  );
}
