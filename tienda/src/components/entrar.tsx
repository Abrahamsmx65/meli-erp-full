"use client";

import { useState } from "react";

export function Entrar({ volver }: { volver: string }) {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [paso, setPaso] = useState<"correo" | "codigo">("correo");
  const [mensaje, setMensaje] = useState<{ texto: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(ruta: string, cuerpo: object) {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "No se pudo.");
      return true;
    } catch (err) {
      setMensaje({ texto: (err as Error).message, error: true });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form
      className="panel"
      style={{ display: "grid", gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (paso === "correo") {
          if (await llamar("/api/cuenta/codigo", { email })) {
            setPaso("codigo");
            setMensaje({ texto: `Te mandamos un código a ${email}. Revisa también tu correo no deseado.` });
          }
        } else if (await llamar("/api/cuenta/entrar", { email, codigo })) {
          window.location.href = volver;
        }
      }}
    >
      {paso === "correo" ? (
        <label className="campo">
          Correo
          <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      ) : (
        <label className="campo">
          Código de 6 dígitos
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.3em", fontSize: 20 }}
          />
        </label>
      )}
      {mensaje && <p className={`nota ${mensaje.error ? "nota-error" : ""}`}>{mensaje.texto}</p>}
      <button className="boton boton-comprar boton-ancho" disabled={ocupado}>
        {paso === "correo" ? "Mandarme el código" : "Entrar"}
      </button>
      {paso === "codigo" && (
        <button type="button" className="enlace" onClick={() => setPaso("correo")}>
          Usar otro correo
        </button>
      )}
    </form>
  );
}

export function Salir() {
  return (
    <button
      className="enlace"
      onClick={async () => {
        await fetch("/api/cuenta/salir", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Salir
    </button>
  );
}
