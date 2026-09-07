"use client";

import { useState } from "react";
import { clienteNavegador } from "@/lib/supabase/client";

export function FormularioClave() {
  const [msj, setMsj] = useState<{ ok?: string; error?: string }>({});
  const [ocupado, setOcupado] = useState(false);

  async function cambiar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const clave = String(form.get("clave"));
    if (clave.length < 8) return setMsj({ error: "Mínimo 8 caracteres." });
    if (clave !== String(form.get("repetir"))) return setMsj({ error: "Las contraseñas no coinciden." });
    setOcupado(true);
    const { error } = await clienteNavegador().auth.updateUser({ password: clave });
    setOcupado(false);
    setMsj(error ? { error: "No se pudo cambiar: " + error.message } : { ok: "Contraseña cambiada." });
    if (!error) e.currentTarget.reset();
  }

  return (
    <form onSubmit={cambiar} className="grid gap-3">
      <label className="campo">Nueva contraseña<input name="clave" type="password" required minLength={8} autoComplete="new-password" /></label>
      <label className="campo">Repetir contraseña<input name="repetir" type="password" required minLength={8} autoComplete="new-password" /></label>
      {msj.error && <div className="aviso aviso-mal">{msj.error}</div>}
      {msj.ok && <div className="aviso aviso-bien">{msj.ok}</div>}
      <button className="boton" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar"}</button>
    </form>
  );
}
