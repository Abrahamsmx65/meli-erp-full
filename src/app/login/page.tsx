"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/client";

/** Dominio de los usuarios de operación, que entran con nombre y no con correo. */
const DOMINIO_USUARIOS = "getac.erp";

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

  // Las pantallas sin contraseña (link de empleados, sección de contenido)
  // nunca deben quedarse en el login: si alguien llegó aquí con ese destino
  // (un link viejo con doble diagonal, una pestaña guardada), se le manda
  // directo. El servidor ya las deja pasar; esto es para el que se quedó
  // parado en esta página.
  useEffect(() => {
    const destino = (params.get("destino") ?? "").replace(/\/{2,}/g, "/");
    if (destino.startsWith("/preparar/") || destino.startsWith("/contenido/")) {
      router.replace(destino);
    }
  }, [params, router]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setMensaje(null);

    const supabase = clienteNavegador();
    // Un usuario de operación («david») entra con su nombre a secas: por
    // dentro es un correo del ERP (david@getac.erp), que nunca recibe nada.
    const email = correo.includes("@") ? correo.trim() : `${correo.trim().toLowerCase()}@${DOMINIO_USUARIOS}`;
    const { error } = await supabase.auth.signInWithPassword({
      email,
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
    <div className="mx-auto mt-6 w-full max-w-sm sm:mt-16">
      <div className="tarjeta p-8">
        <h1 className="titulo-seccion">Entra a tu cuenta</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Inventario, envíos a Full, pedidos a China y ventas, en un solo lugar.
        </p>

        <form onSubmit={enviar} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
            Correo o usuario
            <input
              type="text"
              required
              placeholder="correo@ejemplo.com o usuario"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="email"
              className="text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
            Contraseña
            <input
              type="password"
              required
              minLength={5}
              placeholder="••••••••"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoComplete="current-password"
              className="text-sm font-normal"
            />
          </label>
          <button type="submit" disabled={cargando} className="boton boton-primario mt-2 w-full">
            {cargando ? "Un momento…" : "Entrar"}
          </button>
        </form>

        {mensaje ? (
          <p
            className="mt-4 rounded-md px-3 py-2 text-sm"
            style={{
              color: "var(--estado-critico)",
              background: "color-mix(in oklab, var(--estado-critico) 10%, transparent)",
            }}
          >
            {mensaje}
          </p>
        ) : null}
      </div>
      <p className="mt-4 text-center text-xs" style={{ color: "var(--ink-muted)" }}>
        El acceso es por invitación. Si no puedes entrar, pídele al dueño que dé de alta tu correo.
      </p>
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
        <div className="mx-auto mt-16 max-w-sm text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Cargando…
        </div>
      }
    >
      <FormularioLogin />
    </Suspense>
  );
}
