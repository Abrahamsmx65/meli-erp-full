import { PanelesImportar } from "@/components/importar";
import { Encabezado, Pagina } from "@/components/ui/pagina";

export default function Importar() {
  return (
    <Pagina className="max-w-3xl">
      <Encabezado
        ceja="Sistema"
        titulo="Importar inventario"
        descripcion="Existencias de Industher y corridas del sheet, al momento; el Excel queda de respaldo."
        ayudaTitulo="¿Cuándo hace falta?"
        ayuda={
          <p>
            Todo llega solo cada mañana: las existencias de bodega desde el API de Industher y las corridas desde tu Google
            Sheets. Los botones de abajo sincronizan al momento; el Excel queda solo como respaldo.
          </p>
        }
      />
      <PanelesImportar />
    </Pagina>
  );
}
