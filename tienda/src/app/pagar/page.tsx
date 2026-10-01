import type { Metadata } from "next";
import { clienteActual } from "@/lib/sesion";
import { FormularioPago } from "@/components/formulario-pago";

export const metadata: Metadata = { title: "Pagar" };
export const dynamic = "force-dynamic";

export default async function Pagar() {
  const cliente = await clienteActual();
  const d = (cliente?.direccion ?? {}) as Record<string, string>;
  return (
    <div className="contenedor pagina">
      <h1>Datos de envío</h1>
      <FormularioPago
        conCuenta={Boolean(cliente)}
        inicial={{
          email: cliente?.email ?? "",
          nombre: cliente?.nombre ?? d.nombre ?? "",
          telefono: cliente?.telefono ?? d.telefono ?? "",
          calle: d.calle ?? "",
          numero: d.numero ?? "",
          interior: d.interior ?? "",
          colonia: d.colonia ?? "",
          cp: d.cp ?? "",
          ciudad: d.ciudad ?? "",
          estado: d.estado ?? "",
          referencias: d.referencias ?? "",
        }}
      />
    </div>
  );
}
