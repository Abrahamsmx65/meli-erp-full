import { Escaner } from "./escaner";

export default function PaginaEscanear() {
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <div>
        <h1 className="serif text-3xl font-bold">Escanear boletos</h1>
        <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>
          Apunta la cámara al QR. Verde = pasa (y dice si lleva kit). Rojo = no pasa. Cada boleto entra una sola vez.
        </p>
      </div>
      <Escaner />
    </div>
  );
}
