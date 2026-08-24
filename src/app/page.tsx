import { redirect } from "next/navigation";

/**
 * La portada ya no existe como página propia: el usuario pidió quitar la
 * pestaña de Resumen. La sección de trabajo diaria es Envíos a Full.
 */
export default function Portada() {
  redirect("/envios");
}
