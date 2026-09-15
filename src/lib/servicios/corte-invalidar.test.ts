import { describe, expect, it } from "vitest";
import { invalidarCortesDePeriodos, periodoDeFecha } from "./corte-invalidar";

/** Un Supabase de mentira que apunta cada update con su tabla y filtros. */
function dbFalsa() {
  const escrituras: { tabla: string; cambios: any; filtros: string[] }[] = [];
  const consulta = (tabla: string) => {
    const q: any = {
      select: () => q,
      then: (res: (x: unknown) => void) => res({ data: tabla === "meli_accounts" ? [{ id: "meli-1" }] : [], error: null }),
      update: (cambios: any) => {
        const w = { tabla, cambios, filtros: [] as string[] };
        escrituras.push(w);
        const enc: any = {
          eq: (k: string, v: unknown) => ((w.filtros.push(`${k}=${v}`), enc)),
          in: (k: string, v: unknown[]) => ((w.filtros.push(`${k} in ${v.join(",")}`), enc)),
          or: (f: string) => ((w.filtros.push(`or ${f}`), enc)),
          then: (res: (x: unknown) => void) => res({ error: null }),
        };
        return enc;
      },
    };
    return q;
  };
  return { from: consulta, escrituras };
}

describe("invalidarCortesDePeriodos", () => {
  it("tumba el corte de calzado y el consolidado de los meses dados", async () => {
    const db = dbFalsa();
    await invalidarCortesDePeriodos(db as any, { meliAccountId: "meli-1" }, ["2026-08", "2026-08", "2026-07"], "prueba");
    const tablas = db.escrituras.map((e) => e.tabla);
    expect(tablas).toEqual(["app_cache", "consolidado_cache"]);
    expect(db.escrituras[0].filtros.join(" | ")).toContain("corte:v2:2026-08");
    expect(db.escrituras[1].filtros.join(" | ")).toContain("periodo in 2026-08,2026-07");
    expect(db.escrituras[1].cambios).toEqual({ vigente: false, motivo: "prueba" });
  });

  it("sin cuenta de MELI (fundas, Amazon) busca las cuentas y tumba el consolidado de todas; fundas además su yz_cache", async () => {
    const db = dbFalsa();
    await invalidarCortesDePeriodos(db as any, { meliAccountId: null, yzAccountId: "yz-1" }, ["2026-08"], "prueba");
    expect(db.escrituras.map((e) => e.tabla)).toEqual(["consolidado_cache", "yz_cache"]);
    expect(db.escrituras[0].filtros).toContain("account_id=meli-1");
  });

  it("ignora periodos mal formados y no escribe nada sin periodos", async () => {
    const db = dbFalsa();
    await invalidarCortesDePeriodos(db as any, { meliAccountId: "meli-1" }, ["2026-08-15", "x"], "prueba");
    expect(db.escrituras).toEqual([]);
    expect(periodoDeFecha("2026-08-15")).toBe("2026-08");
  });
});
