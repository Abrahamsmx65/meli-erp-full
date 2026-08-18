"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/client";

function FormularioLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  // El registro está cerrado con una lista de correos autorizados aplicada en
  // la base. Ofrecer "crear cuenta" solo llevaría a un error confuso.
  const modo = "entrar" as const;
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setMensaje(null);

    const supabase = clienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({
      email: correo,
      password: clave,
    });

    setCargando(false);

    if (error) {
      setMensaje(error.message);
      return;
    }


    router.push(params.get("destino") ?? "/");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-xl font-semibold">Planeador de envíos a Full</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Entra con tu correo.
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
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={cargando}
          className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--acento)" }}
        >
          {cargando ? "Un momento…" : "Entrar"}
        </button>
      </form>

      {mensaje ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {mensaje}
        </p>
      ) : null}
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
