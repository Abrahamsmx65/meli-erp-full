import { adminActual } from "@/lib/auth";
import { FormularioClave } from "./formulario";

export default async function Cuenta() {
  const admin = await adminActual();
  return (
    <div className="mx-auto grid max-w-md gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Mi cuenta</h1>
        <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>{admin?.correo}</p>
      </div>
      <div className="tarjeta p-6">
        <h2 className="mb-3 font-bold">Cambiar contraseña</h2>
        <FormularioClave />
      </div>
    </div>
  );
}
