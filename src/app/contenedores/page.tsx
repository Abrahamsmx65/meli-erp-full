import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarContenedores } from "@/lib/servicios/contenedores";
import { amarreDeLineas, coloresFantasma, coloresLigados } from "@/lib/servicios/amarre-pedido";
import { TablaContenedores } from "@/components/tabla-contenedores";
import { SubirPackingList } from "@/components/subir-packing-list";
import { PackingDrive, type ArchivoDriveVista } from "@/components/packing-drive";
import { configDrive } from "@/lib/servicios/drive";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

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

  if (!cuenta) return <SinCuenta titulo="Contenedores" />;

  const [contenedores, drive] = await Promise.all([
    listarContenedores(supabase, cuenta.id),
    supabase
      .from("drive_packing_lists")
      .select("nombre, estado, motivo, procesado_en, contenedor_id")
      .eq("account_id", cuenta.id)
      .order("procesado_en", { ascending: false })
      .limit(30),
  ]);
  // Colores de lo que viene en camino que MELI no tiene como los escribió la
  // fábrica (pedido del dueño, 7-oct-2026: «lo mismo en los packing lists de
  // China, lo que hay en camino en contenedores»): se marcan en rojo y se
  // ligan con la misma ventana que en Cargar pedidos. Solo los no recibidos.
  const vivos = contenedores.filter((c) => c.estado !== "recibido");
  const lineasAmarre = vivos.flatMap((c) => c.modelos.map((m) => ({ contenedorId: c.id, modelo: m.modelo, color: m.color })));
  const amarres = await amarreDeLineas(supabase, cuenta.id, lineasAmarre).catch(() => []);
  const contenedoresVista = contenedores.map((c) => {
    const indices = lineasAmarre.map((l, i) => (l.contenedorId === c.id ? i : -1)).filter((i) => i >= 0);
    const suyas = indices.map((i) => lineasAmarre[i]);
    const propios = indices.map((i) => amarres[i]);
    return { ...c, sinSku: coloresFantasma(suyas, propios), ligados: coloresLigados(suyas, propios) };
  });
  const enCamino = contenedores.filter((c) => c.estado !== "recibido");
  // Reparto de la tabla en pestañas (mismos renglones, mismo orden).
  const borradores = contenedoresVista.filter((c) => c.estado === "borrador");
  const recibidos = contenedoresVista.filter((c) => c.estado === "recibido");
  const transito = contenedoresVista.filter((c) => c.estado !== "borrador" && c.estado !== "recibido");
  const numeroPorId = new Map(contenedores.map((c) => [c.id, c.numero]));
  const archivosDrive: ArchivoDriveVista[] = (drive.data ?? []).map((a) => ({
    nombre: a.nombre,
    estado: a.estado,
    motivo: a.motivo ?? null,
    procesadoEn: a.procesado_en,
    contenedor: a.contenedor_id ? (numeroPorId.get(a.contenedor_id) ?? null) : null,
  }));

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Contenedores"
        descripcion="Cada contenedor con nuestro propio ID; sube el packing list de la fábrica y se arma solo."
        ayuda={
          <>
            <p>
              Confirmar la llegada no suma inventario: las existencias llegan solas del API de
              Industher.
            </p>
            <p>
              Del packing list salen nuestro ID (la referencia del embarque, S259-2026), el número
              de la naviera (MIEU…), los pedidos y las cajas de cada modelo y color. Se amarra por
              pedido + modelo + color + talla contra los pedidos ya cargados; lo que no amarra se
              enseña y no se guarda.
            </p>
          </>
        }
      />

      <Cifras columnas={4}>
        <Ficha titulo="En camino" valor={n(enCamino.length)} />
        <Ficha
          titulo="Cajas en camino"
          valor={n(enCamino.reduce((a, c) => a + c.cajas, 0))}
        />
        <Ficha titulo="Recibidos" valor={n(contenedores.length - enCamino.length)} />
        <Ficha titulo="Total" valor={n(contenedores.length)} />
      </Cifras>

      <PackingDrive
        archivos={archivosDrive}
        configurado={true}
        conLlave={Boolean(configDrive().apiKey)}
        borradores={contenedores.filter((c) => c.estado === "borrador").map((c) => c.numero)}
      />

      <SubirPackingList />

      {/* Pestañas por estado: la tabla es la misma, solo se reparte. Si no
           hay ningún contenedor, la tabla enseña su mensaje de vacío. El
           packing list se sube arriba, fuera de las pestañas, para que
           cambiar de pestaña no tire una carga a medias. */}
      {contenedores.length ? (
        <Pestanas
          pestanas={[
            transito.length > 0 && {
              id: "transito",
              titulo: "En camino",
              cuenta: transito.length,
              contenido: <TablaContenedores contenedores={transito} />,
            },
            borradores.length > 0 && {
              id: "borradores",
              titulo: "Borradores",
              cuenta: borradores.length,
              alerta: true,
              contenido: <TablaContenedores contenedores={borradores} />,
            },
            recibidos.length > 0 && {
              id: "recibidos",
              titulo: "Recibidos",
              cuenta: recibidos.length,
              contenido: <TablaContenedores contenedores={recibidos} />,
            },
          ]}
        />
      ) : (
        <TablaContenedores contenedores={contenedoresVista} />
      )}
    </Pagina>
  );
}
