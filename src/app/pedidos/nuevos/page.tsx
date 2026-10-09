import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { CLAVE_FOTOS_NUEVOS, FOTOS_MINIMAS, servirProductosNuevos } from "@/lib/servicios/productos-nuevos";
import { fotosGuardadasVigentes, type FotosGuardada } from "@/lib/servicios/productos-nuevos-fotos";
import { leerCacheAppGuardado } from "@/lib/servicios/cache-app";
import { Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { Ficha } from "@/components/tiles";
import { ProductosNuevos } from "@/components/productos-nuevos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Productos nuevos en camino: lo pedido a China que nunca ha tenido stock.
 * Es la lista de lo que hay que dejar listo (publicación y fotos en MELI y
 * Amazon) antes de que llegue el contenedor.
 */
export default async function Nuevos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Lanzamientos" />;

  // La lista sale masticada (lo guardado aunque esté viejo; se refresca por
  // atrás) y las fotos YA REVISADAS se leen guardadas: preguntarle a MELI y
  // Amazon en cada visita queda solo para los botones de revisar.
  const [servida, fotosGuardadas] = await Promise.all([
    servirProductosNuevos(supabase, cuenta.id),
    leerCacheAppGuardado<{ productos: Record<string, FotosGuardada> }>(supabase, cuenta.id, CLAVE_FOTOS_NUEVOS),
  ]);
  const { productos, amazonConectado } = servida.datos;
  const fotosIniciales = fotosGuardadasVigentes(
    productos,
    fotosGuardadas.estado === "encontrado" ? fotosGuardadas.valor.datos?.productos : null,
  );
  const sinMeli = productos.filter((p) => !p.meli.publicaciones.length).length;
  const sinAmazon = amazonConectado ? productos.filter((p) => !p.amazon.skus.length).length : 0;
  const enBodega = productos.filter((p) => p.enBodega > 0).length;

  return (
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Lanzamientos"
        descripcion="Lo pedido que nunca ha tenido stock: si ya está publicado en MELI y Amazon y con cuántas fotos."
        frescura={servida.generadoEn}
        ayuda={
          <p>
            Todo lo que viene en los pedidos y que <strong>nunca ha tenido stock</strong> en
            Full ni en FBA. De cada uno se revisa si ya está publicado en Mercado Libre y en
            Amazon y cuántas fotos tiene: con una sola no alcanza, hacen falta al menos{" "}
            {FOTOS_MINIMAS}.
          </p>
        }
      />

      <Cifras columnas={4}>
        <Ficha titulo="Productos nuevos" valor={n(productos.length)} nota="Modelo + color" />
        <Ficha
          titulo="Sin publicar en MELI"
          valor={n(sinMeli)}
          tono={sinMeli > 0 ? "critico" : "bien"}
        />
        <Ficha
          titulo="Sin publicar en Amazon"
          valor={amazonConectado ? n(sinAmazon) : "—"}
          nota={amazonConectado ? undefined : "Amazon no conectado"}
          tono={sinAmazon > 0 ? "alerta" : "neutro"}
        />
        <Ficha titulo="Ya en bodega" valor={n(enBodega)} nota="Llegaron y siguen sin stock en Full" />
      </Cifras>

      <ProductosNuevos
        productos={productos}
        fotosMinimas={FOTOS_MINIMAS}
        amazonConectado={amazonConectado}
        fotosIniciales={fotosIniciales}
      />
    </Pagina>
  );
}
