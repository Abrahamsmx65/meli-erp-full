import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { catalogoParaConteo } from "@/lib/servicios/tiktok-conteo";
import { clienteAdmin } from "@/lib/supabase/server";
import { ConteoTikTok } from "@/components/conteo-tiktok";

export const dynamic = "force-dynamic";

/** El conteo cíclico desde la estación sin sesión: la puerta es el token. */
export default async function ConteoPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) {
    return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Este link ya no sirve.</div>;
  }

  const productos = await catalogoParaConteo(clienteAdmin(), cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Conteo cíclico · TikTok</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Escanea el FNSKU de cada par. Si cuentas un modelo completo, elígelo arriba.
          </p>
        </div>
        <Link href={`/preparar/${token}`} className="text-sm underline" style={{ color: "var(--ink-2)" }}>
          ← Cortes
        </Link>
      </div>
      <ConteoTikTok productos={productos} urlGuardar={`/api/preparar-publico/${token}/conteo`} />
    </div>
  );
}
