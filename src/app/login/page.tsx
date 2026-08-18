"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/client";

function FormularioLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [modo, setModo] = useState<"entrar" | "registrar">("entrar");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setMensaje(null);

    const supabase = clienteNavegador();
    const { error } =
      modo === "entrar"
        ? await supabase.auth.signInWithPassword({ email: correo, password: clave })
        : await supabase.auth.signUp({ email: correo, password: clave });

    setCargando(false);

    if (error) {
      setMensaje(error.message);
      return;
    }

    if (modo === "registrar") {
      setMensaje("Cuenta creada. Si tu proyecto pide confirmar el correo, revísalo y luego entra.");
      setModo("entrar");
      return;
    }

    router.push(params.get("destino") ?? "/");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-xl font-semibold">Planeador de envíos a Full</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        {modo === "entrar" ? "Entra con tu correo." : "Crea tu cuenta."}
      </p>

      <form onSubmit={enviar} className="mt-6 flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="correo@ejemplo.com"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          autoComplete="email"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Contraseña"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
        />
        <button
          type="submit"
          disabled={cargando}
          className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {cargando ? "Un momento…" : modo === "entrar" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      {mensaje ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {mensaje}
        </p>
      ) : null}

      <button
        onClick={() => setModo(modo === "entrar" ? "registrar" : "entrar")}
        className="mt-4 text-sm underline"
        style={{ color: "var(--ink-2)" }}
      >
        {modo === "entrar" ? "No tengo cuenta" : "Ya tengo cuenta"}
      </button>
    </div>
  );
}

/**
 * useSearchParams obliga a renderizar en el cliente; el Suspense deja que la
 * página siga siendo prerenderizable y evita el parpadeo en blanco.
 */
export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-sm py-16 text-sm" style={{ color: "var(--ink-2)" }}>
          Cargando…
        </div>
      }
    >
      <FormularioLogin />
    </Suspense>
  );
}
