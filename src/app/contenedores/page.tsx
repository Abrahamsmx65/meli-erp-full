import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarContenedores } from "@/lib/servicios/contenedores";
import { TablaContenedores } from "@/components/tabla-contenedores";
import { SubirPackingList } from "@/components/subir-packing-list";
import { PackingDrive, type ArchivoDriveVista } from "@/components/packing-drive";
import { configDrive } from "@/lib/servicios/drive";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Los contenedores en tránsito, con NUESTRO propio ID como llave. Aquí se
 * edita la ETA y el número de la naviera, se confirma la llegada (sin tocar
 * existencias: eso llega del API de Industher) y se baja el packing list.
 */
export default async function Contenedores() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los contenedores cuelgan de los pedidos a China, y esos viven en tu
          cuenta.
        </p>
        <Link
          href="/ajustes"
          className="mt-3 inline-block underline"
          style={{ color: "var(--acento)" }}
        >
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const [contenedores, drive] = await Promise.all([
    listarContenedores(supabase, cuenta.id),
    supabase
      .from("drive_packing_lists")
      .select("nombre, estado, motivo, procesado_en, contenedor_id")
      .eq("account_id", cuenta.id)
      .order("procesado_en", { ascending: false })
      .limit(30),
  ]);
  const enCamino = contenedores.filter((c) => c.estado !== "recibido");
  const numeroPorId = new Map(contenedores.map((c) => [c.id, c.numero]));
  const archivosDrive: ArchivoDriveVista[] = (drive.data ?? []).map((a) => ({
    nombre: a.nombre,
    estado: a.estado,
    motivo: a.motivo ?? null,
    procesadoEn: a.procesado_en,
    contenedor: a.contenedor_id ? (numeroPorId.get(a.contenedor_id) ?? null) : null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="titulo-pagina">Contenedores</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Cada contenedor con nuestro propio ID. Sube el packing list de la fábrica y
          el contenedor se arma solo. Confirmar la llegada no suma inventario: las
          existencias llegan solas del API de Industher.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="En camino" valor={n(enCamino.length)} />
        <Ficha
          titulo="Cajas en camino"
          valor={n(enCamino.reduce((a, c) => a + c.cajas, 0))}
        />
        <Ficha titulo="Recibidos" valor={n(contenedores.length - enCamino.length)} />
        <Ficha titulo="Total" valor={n(contenedores.length)} />
      </div>

      <PackingDrive
        archivos={archivosDrive}
        configurado={true}
        conLlave={Boolean(configDrive().apiKey)}
        borradores={contenedores.filter((c) => c.estado === "borrador").map((c) => c.numero)}
      />

      <SubirPackingList />

      <TablaContenedores contenedores={contenedores} />
    </div>
  );
}
