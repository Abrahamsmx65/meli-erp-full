import Link from "next/link";

export default function NoEncontrado() {
  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-extrabold">No encontramos eso</h1>
      <p style={{ color: "var(--tinta-2)" }}>El enlace no existe o ya no está disponible.</p>
      <Link href="/" className="boton mx-auto">
        Ir al inicio
      </Link>
    </main>
  );
}
