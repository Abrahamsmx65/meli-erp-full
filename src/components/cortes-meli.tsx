"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GastoManual } from "@/lib/servicios/corte-meli";

/**
 * Lo interactivo del corte: hacer el corte, revisar devoluciones, leer la
 * facturación de MELI y capturar gastos. Las cifras las pinta la página
 * (servidor); aquí solo se disparan acciones y se refresca.
 */

async function leer(r: Response): Promise<any> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    if (r.status === 504 || /timed? ?out/i.test(texto)) {
      throw new Error("Se pasó del tiempo máximo. Vuelve a darle: retoma donde se quedó.");
    }
    throw new Error(`El servidor contestó algo que no se pudo leer (${r.status}).`);
  }
}

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AccionesCorte({
  periodo,
  pendientes,
  cargosLeidos,
  corteId,
}: {
  periodo: string;
  pendientes: number;
  cargosLeidos: boolean;
  corteId: number | null;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr(tarea: "corte" | "revisar" | "cargos") {
    setOcupado(tarea);
    setAviso(null);
    setError(null);
    try {
      const ruta = tarea === "corte" ? "/api/ventas/cortes" : tarea === "revisar" ? "/api/ventas/revisar" : "/api/ventas/cargos";
      const r = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo }),
      });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo.");
      if (tarea === "corte") {
        const rev = j.revision;
        const detalle = rev
          ? ` Revisadas ${rev.revisadas} órdenes (${rev.canceladas} canceladas, ${rev.devueltas} devueltas)${rev.quedan > 0 ? `; faltan ${rev.quedan} por revisar` : ""}.`
          : j.errorRevision
            ? ` La revisión de devoluciones no corrió: ${j.errorRevision}`
            : "";
        setAviso(`Corte guardado: utilidad neta ${pesos(j.utilidadNeta)}${j.exacto ? " (exacto)" : " (con pendientes, ver avisos)"}.${detalle}`);
      } else if (tarea === "revisar") {
        setAviso(
          `Revisadas ${j.revisadas} órdenes: ${j.canceladas} canceladas y ${j.devueltas} devueltas${j.diasRebarridos?.length ? `; ${j.diasRebarridos.length} días re-barridos` : ""}. ${j.quedan > 0 ? `Faltan ${j.quedan}: vuelve a darle.` : "No falta ninguna."}`,
        );
      } else {
        setAviso(
          `Facturación de MELI: ${j.cargos} renglones guardados${j.total != null ? ` de ${j.total}` : ""}${j.completo ? " (completo)" : " — sigue en segundo plano, MELI da 5 páginas por minuto"}; de Full hasta ahora: ${pesos(j.full)}.${j.error ? ` ${j.error}` : ""}`,
        );
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton boton-primario" disabled={ocupado != null} onClick={() => correr("corte")}>
          {ocupado === "corte" ? "Revisando órdenes y cortando…" : corteId ? `Rehacer corte de ${periodo}` : `Hacer corte de ${periodo}`}
        </button>
        <button type="button" className="boton boton-secundario" disabled={ocupado != null} onClick={() => correr("revisar")}>
          {ocupado === "revisar" ? "Revisando…" : pendientes > 0 ? `Revisar devoluciones (${pendientes.toLocaleString("es-MX")} pendientes)` : "Revisar devoluciones"}
        </button>
        <button type="button" className="boton boton-secundario" disabled={ocupado != null} onClick={() => correr("cargos")}>
          {ocupado === "cargos" ? "Leyendo…" : cargosLeidos ? "Releer facturación de MELI" : "Leer facturación de MELI"}
        </button>
        <a className="boton boton-fantasma" href={`/api/ventas/cortes/pdf?periodo=${periodo}`} target="_blank" rel="noreferrer">
          PDF de vista previa
        </a>
        {corteId ? (
          <a className="boton boton-fantasma" href={`/api/ventas/cortes/${corteId}/pdf`} target="_blank" rel="noreferrer">
            PDF del corte guardado
          </a>
        ) : null}
      </div>
      {aviso ? (
        <p className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const NOMBRE_CATEGORIA: Record<GastoManual["categoria"], string> = {
  full: "Gasto de Full",
  publicidad: "Publicidad",
  otro: "Otro gasto",
};

export function GastosDelMes({ gastos, desde, hasta }: { gastos: GastoManual[]; desde: string; hasta: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hasta);
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState<GastoManual["categoria"]>("full");
  const [monto, setMonto] = useState("");

  async function agregar(ev: React.FormEvent) {
    ev.preventDefault();
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch("/api/ventas/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, concepto, categoria, monto: Number(monto) }),
      });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el gasto.");
      setConcepto("");
      setMonto("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function borrar(id: number) {
    if (!confirm("¿Borrar este gasto?")) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch("/api/ventas/gastos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await leer(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo borrar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const entrada = "rounded-lg border px-2 py-1 text-sm";
  const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

  return (
    <div>
      {gastos.length ? (
        <table className="datos">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Tipo</th>
              <th className="num">Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <tr key={g.id}>
                <td className="cifra">{g.fecha}</td>
                <td>{g.concepto}</td>
                <td>{NOMBRE_CATEGORIA[g.categoria]}</td>
                <td className="num cifra">{pesos(g.monto)}</td>
                <td className="num">
                  <button type="button" className="text-xs" style={{ color: "var(--estado-critico)" }} disabled={ocupado} onClick={() => borrar(g.id)}>
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
          Sin gastos capturados a mano en este mes.
        </p>
      )}
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 border-t p-3 hairline">
        <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          Fecha
          <input type="date" className={entrada} style={estiloEntrada} value={fecha} min={desde} max={hasta} onChange={(e) => setFecha(e.target.value)} required />
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          Concepto
          <input className={entrada} style={estiloEntrada} value={concepto} placeholder="Almacenamiento Full, retiro de stock, diseñador…" onChange={(e) => setConcepto(e.target.value)} required />
        </label>
        <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          Tipo
          <select className={entrada} style={estiloEntrada} value={categoria} onChange={(e) => setCategoria(e.target.value as GastoManual["categoria"])}>
            <option value="full">Gasto de Full</option>
            <option value="publicidad">Publicidad</option>
            <option value="otro">Otro gasto</option>
          </select>
        </label>
        <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          Monto (MXN)
          <input type="number" step="0.01" className={entrada} style={estiloEntrada} value={monto} onChange={(e) => setMonto(e.target.value)} required />
        </label>
        <button type="submit" className="boton boton-secundario" disabled={ocupado}>
          Agregar gasto
        </button>
      </form>
      {error ? (
        <p className="px-3 pb-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
