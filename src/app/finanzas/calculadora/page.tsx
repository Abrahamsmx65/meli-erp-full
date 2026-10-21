import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { cargarCalculadora, listaContenedores } from "@/lib/servicios/calculadora-precios";
import { nombreDelPeriodo } from "@/lib/servicios/corte-meli";
import { CalculadoraFiscal } from "@/components/calculadora-fiscal";
import { Aviso, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Calculadora FISCAL de precios entre empresas (dueño, 21-oct-2026): a qué
 * precio le compra Komerline a Industher y a qué precio compra Industher,
 * por producto y en el Excel de la factura de un contenedor. Es puramente
 * fiscal: solo LEE el estado de resultados guardado y Números, no escribe
 * nada en el corte general ni cambia sus números. El motor vive en
 * `finanzas/calculadora-precios.ts`.
 */
export default async function Calculadora() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Calculadora fiscal" />;
  const db = supabase as DB;
  const [calc, contenedores] = await Promise.all([cargarCalculadora(db, cuenta), listaContenedores(db, cuenta.id)]);

  return (
    <Pagina>
      <Encabezado
        ceja="Negocio"
        titulo="Calculadora fiscal"
        ayuda={
          <div className="flex flex-col gap-2 text-[13px]">
            <p>
              <b>Komerline</b> (vende en Mercado Libre) le compra a Industher a lo que recibe por par de MELI (depósito real de Mercado Pago) menos los
              gastos de Full por par y la publicidad por par (la del modelo más la sin amarre del canal), promedio de los meses cerrados elegidos.
              Así casi no le queda ganancia.
            </p>
            <p>
              <b>Producto nuevo</b> (menos de 10 pares vendidos en esos meses): lo que MELI deposita al precio relámpago de Números, menos el Full y la
              publicidad promedio por par del canal.
            </p>
            <p>
              <b>Industher</b> compra a: precio Komerline − gasto de logística y empleados ÷ unidades vendidas al mes (todas las plataformas) − su
              ganancia (3 % de lo que le factura a Komerline).
            </p>
            <p>Todo lleva IVA trasladado: los precios son con IVA y la base sin IVA es ÷ 1.16. Es una cuenta fiscal aparte: no cambia el Estado de resultados.</p>
          </div>
        }
      />
      <Aviso tono="info">
        Promedio de {calc.meses.filter((m) => !calc.mesesFaltantes.includes(m)).map(nombreDelPeriodo).join(", ") || "ningún mes"}.
      </Aviso>
      {calc.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}
      <Seccion sinRelleno>
        <div className="p-3">
          <CalculadoraFiscal calc={calc} contenedores={contenedores} />
        </div>
      </Seccion>
    </Pagina>
  );
}
