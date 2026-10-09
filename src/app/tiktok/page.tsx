import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { cargarPanelTikTok, DIAS_VENTA } from "@/lib/servicios/tiktok-panel";
import { AccionesTikTok } from "@/components/tiktok-acciones";
import { EntradasTikTok } from "@/components/tiktok-entradas";
import { AliasAmazonTikTok } from "@/components/alias-amazon-tiktok";
import { InventarioTikTok } from "@/components/inventario-tiktok";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function cuando(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NOMBRE_TIPO: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
  devolucion: "Devolución",
  merma: "Merma",
  ajuste: "Ajuste",
};

/**
 * El almacén de TikTok Shop.
 *
 * Es el único canal donde el ERP no lee el inventario, sino que lo LLEVA: los
 * pares salen de una bodega nuestra, así que lo que aquí diga es lo que
 * TikTok le ofrece a un comprador. La pantalla está armada alrededor de esa
 * responsabilidad — arriba lo que TikTok todavía no sabe, y luego el porqué.
 */
export default async function TikTok({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  // TikTok cuelga de la cuenta de MELI del ERP: sin ella no hay catálogo con
  // qué amarrar sus publicaciones.
  if (!cuenta) return <SinCuenta titulo="Almacén TikTok Shop" />;

  // Las dos lecturas son independientes: van a la par.
  const [p, aliasRaw] = await Promise.all([
    cargarPanelTikTok(supabase, cuenta.id),
    traerTodo<any>(supabase, "tiktok_alias_amazon", "modelo, color_tiktok, color_amazon", (q) => q.eq("account_id", cuenta.id)),
  ]);
  const alias = (aliasRaw ?? []).map((a: any) => ({ modelo: a.modelo, colorTikTok: a.color_tiktok, colorAmazon: a.color_amazon }));

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Almacén TikTok Shop"
        descripcion={`Kardex de la bodega TikTok y lo que se le publica a la tienda. Última sincronización: ${cuando(p.ultimaSync)}.`}
        acciones={p.conectado ? <AccionesTikTok porPublicar={p.totales.porPublicar} /> : null}
        ayuda={
          <>
            <p>
              Envío propio. Lo que entra a la bodega TikTok de Industher entra solo; un pedido pagado aparta y el envío
              confirmado descuenta. El disponible se le escribe a TikTok.
            </p>
            <p>
              Es el único canal donde el ERP no lee el inventario, sino que lo LLEVA: lo que aquí diga es lo que TikTok le
              ofrece a un comprador.
            </p>
          </>
        }
      />

      {sp.ok ? <Aviso tono="bien">{sp.ok}</Aviso> : null}
      {sp.error ? <Aviso tono="critico">{sp.error}</Aviso> : null}

      {!p.conectado ? (
        <Seccion titulo="TikTok Shop no está conectado">
          <p className="texto-2 text-sm">
            El kardex ya funciona sin conexión: puedes capturar entradas y llevar el saldo. Lo que falta al conectar es lo
            importante — que el disponible se le escriba a TikTok solo, y que los envíos confirmados descuenten sin
            capturarlos.
          </p>
          <Aviso tono="alerta" className="mt-3">
            La conexión se inicia SOLO desde este botón. Si autorizas desde el panel de TikTok (partner.tiktokshop.com),
            TikTok te regresa sin forma de amarrarlo a tu sesión y no queda conectado.
          </Aviso>
          <a href="/api/tiktok/conectar" className="boton boton-primario mt-3">
            Conectar TikTok Shop
          </a>
        </Seccion>
      ) : null}

      <Cifras columnas={5}>
        <Ficha titulo="SKUs" valor={p.totales.skus} nota="con movimiento" />
        <Ficha titulo="En almacén" valor={n(p.totales.saldo)} nota="pares físicos" />
        <Ficha
          titulo="Apartado"
          valor={n(p.totales.apartado)}
          nota="pagado o por pagar, sin salir"
          tono={p.totales.apartado ? "alerta" : "neutro"}
        />
        <Ficha titulo="Disponible" valor={n(p.totales.disponible)} nota="ofrecible a compradores" />
        <Ficha
          titulo="Por publicar"
          valor={p.totales.porPublicar}
          nota="TikTok no lo sabe aún"
          tono={p.totales.porPublicar ? "critico" : "bien"}
        />
      </Cifras>

      {p.totales.enRojo ? (
        <Aviso tono="critico">
          {p.totales.enRojo} SKU con saldo negativo: se vendieron pares que nunca se capturaron como entrada. Captura la
          entrada que falta o haz un ajuste por conteo.
        </Aviso>
      ) : null}

      <AliasAmazonTikTok alias={alias} />

      <EntradasTikTok />

      <InventarioTikTok renglones={p.renglones} diasVenta={DIAS_VENTA} />

      <Seccion
        titulo="Últimos movimientos"
        descripcion="Cada par que entró o salió, con su motivo: deja auditar un saldo sin creerle a nadie."
        sinRelleno
      >
        <Tabla vacia={!p.movimientos.length} textoVacio="Sin movimientos todavía.">
          <table className="datos">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>SKU</th>
                <th>Movimiento</th>
                <th className="num">Pares</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {p.movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="texto-2">{cuando(m.fecha)}</td>
                  <td className="font-medium">{m.sku}</td>
                  <td>{NOMBRE_TIPO[m.tipo] ?? m.tipo}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        m.tipo === "salida" || m.tipo === "merma"
                          ? "var(--estado-critico)"
                          : m.tipo === "ajuste"
                            ? "var(--ink-1)"
                            : "var(--exito-texto)",
                    }}
                  >
                    {m.tipo === "ajuste" ? "=" : m.tipo === "salida" || m.tipo === "merma" ? "−" : "+"}
                    {n(m.cantidad)}
                  </td>
                  <td className="texto-2">
                    {m.motivo ?? "—"}
                    {m.referencia ? ` · pedido ${m.referencia}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </Seccion>
    </Pagina>
  );
}
