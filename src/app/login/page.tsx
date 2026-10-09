"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/client";
import { Aviso } from "@/components/ui/pagina";
import { Logo } from "@/components/logo";

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
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Lado de la marca: solo en pantallas anchas. */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: "#f3ebdf", color: "var(--ink-1)" }}
      >
        <Logo alto={64} />
        <div className="relative max-w-md">
          <p className="ceja" style={{ color: "var(--acento)" }}>
            Calzado · Mercado Libre · Amazon · TikTok Shop
          </p>
          <h1 className="mt-4 text-[34px] leading-[1.15] font-semibold tracking-tight text-balance" style={{ color: "var(--ink-1)", fontFamily: "var(--fuente-titulo)" }}>
            Qué mandar, qué pedir y cuánto ganas, en un solo lugar.
          </h1>
        </div>
        <ul className="relative grid grid-cols-3 gap-4 text-[12px]" style={{ color: "var(--ink-2)" }}>
          {[
            ["Inventario", "Bodega, Full y FBA"],
            ["Abastecimiento", "Pedidos y contenedores"],
            ["Dinero", "Cortes al centavo"],
          ].map(([t, d]) => (
            <li key={t} className="border-t pt-3" style={{ borderColor: "#e0d2bf" }}>
              <span className="block font-semibold" style={{ color: "var(--ink-1)" }}>{t}</span>
              {d}
            </li>
          ))}
        </ul>
        {/* Retícula tenue: el papel milimétrico de una corrida de tallas. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(139,102,64,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(139,102,64,.06) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse at 70% 40%, #000 20%, transparent 75%)",
          }}
        />
      </aside>

      <main className="flex items-center justify-center px-5 py-12" style={{ background: "var(--surface-1)" }}>
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <div className="inline-flex">
              <Logo alto={52} />
            </div>
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight">Entra a tu cuenta</h2>
          <p className="texto-2 mt-1.5 text-sm">Usa tu correo o tu nombre de usuario.</p>

          <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Correo o usuario
              <input
                type="text"
                required
                placeholder="correo@ejemplo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                autoComplete="email"
                className="h-11 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Contraseña
              <input
                type="password"
                required
                minLength={5}
                placeholder="••••••••"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                autoComplete="current-password"
                className="h-11 text-sm font-normal"
              />
            </label>
            <button type="submit" disabled={cargando} className="boton boton-primario mt-2 h-11 w-full">
              {cargando ? "Entrando…" : "Entrar"}
            </button>
          </form>

          {mensaje ? (
            <Aviso tono="critico" className="mt-4">
              {mensaje}
            </Aviso>
          ) : null}

          <p className="texto-tenue mt-10 text-xs">
            El acceso es por invitación. Si no puedes entrar, pide que den de alta tu correo.
          </p>
        </div>
      </main>
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
        <div className="grid min-h-dvh place-items-center text-sm texto-2">Cargando…</div>
      }
    >
      <FormularioLogin />
    </Suspense>
  );
}
