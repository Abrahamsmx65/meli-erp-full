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
    // Se puede entrar con un nombre de usuario corto ("Diana"): por dentro
    // es una cuenta con correo ficticio @boletos.local.
    const usuario = String(form.get("correo")).trim().toLowerCase();
    const { error } = await clienteNavegador().auth.signInWithPassword({
      email: usuario.includes("@") ? usuario : `${usuario}@boletos.local`,
      password: String(form.get("clave")),
    });
    if (error) {
      setError("Usuario o contraseña incorrectos.");
      setCargando(false);
      return;
    }
    router.replace(volver);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="grid gap-4">
      <label className="campo">
        Usuario o correo
        <input name="correo" type="text" required autoComplete="username" />
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
