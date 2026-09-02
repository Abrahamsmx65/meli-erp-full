"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clienteNavegador } from "@/lib/supabase/client";

export function FormularioLogin({ volver }: { volver: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await clienteNavegador().auth.signInWithPassword({
      email: String(form.get("correo")),
      password: String(form.get("clave")),
    });
    if (error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }
    router.replace(volver);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="grid gap-4">
      <label className="campo">
        Correo
        <input name="correo" type="email" required autoComplete="username" />
      </label>
      <label className="campo">
        Contraseña
        <input name="clave" type="password" required autoComplete="current-password" />
      </label>
      {error && <div className="aviso aviso-mal">{error}</div>}
      <button className="boton" disabled={cargando}>
        {cargando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
