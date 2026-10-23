/**
 * Dónde anotan sus corridas las relámpago, Buen Fin y las ofertas con
 * aporte: el calzado en `sync_log` (cuenta de `meli_accounts`) y las fundas
 * en `yz_sync_log` (cuenta de `yz_cuentas`, la tarea va DENTRO de `detalle`
 * y la hora es `corrido_en`). Las dos cuentas no comparten tabla porque
 * cada una amarra a su propia lista de cuentas.
 */
import type { DB } from "../datos/repos";

export interface RenglonBitacora {
  fin: string;
  estado: "ok" | "error";
  detalle: Record<string, unknown>;
}

export interface Bitacora {
  anotar(tarea: string, estado: "ok" | "error", detalle: Record<string, unknown>): Promise<void>;
  /** Más nuevo primero, o más viejo primero con `ascendente`. */
  leer(tarea: string, opciones?: { desde?: string; limite?: number; ascendente?: boolean }): Promise<RenglonBitacora[]>;
}

export function bitacoraCalzado(admin: DB, accountId: string): Bitacora {
  return {
    async anotar(tarea, estado, detalle) {
      await admin.from("sync_log").insert({ account_id: accountId, tarea, estado, fin: new Date().toISOString(), detalle });
    },
    async leer(tarea, o = {}) {
      let q = admin
        .from("sync_log")
        .select("fin, estado, detalle")
        .eq("account_id", accountId)
        .eq("tarea", tarea)
        .order("fin", { ascending: Boolean(o.ascendente) })
        .limit(o.limite ?? 1);
      if (o.desde) q = q.gte("fin", o.desde);
      const { data } = await q;
      return ((data ?? []) as { fin: string; estado: string; detalle: Record<string, unknown> | null }[]).map((r) => ({
        fin: r.fin,
        estado: r.estado === "error" ? "error" : "ok",
        detalle: r.detalle ?? {},
      }));
    },
  };
}

export function bitacoraFundas(admin: DB, accountId: string): Bitacora {
  return {
    async anotar(tarea, estado, detalle) {
      await admin.from("yz_sync_log").insert({ account_id: accountId, ok: estado === "ok", detalle: { ...detalle, tarea } });
    },
    async leer(tarea, o = {}) {
      let q = admin
        .from("yz_sync_log")
        .select("corrido_en, ok, detalle")
        .eq("account_id", accountId)
        .eq("detalle->>tarea", tarea)
        .order("corrido_en", { ascending: Boolean(o.ascendente) })
        .limit(o.limite ?? 1);
      if (o.desde) q = q.gte("corrido_en", o.desde);
      const { data } = await q;
      return ((data ?? []) as { corrido_en: string; ok: boolean; detalle: Record<string, unknown> | null }[]).map((r) => ({
        fin: r.corrido_en,
        estado: r.ok ? "ok" : "error",
        detalle: r.detalle ?? {},
      }));
    },
  };
}
