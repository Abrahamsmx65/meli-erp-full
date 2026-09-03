import QRCode from "qrcode";
import { urlBoleto } from "./codigos";

/** PNG del QR de un boleto (para el correo y la página del boleto). */
export async function qrPng(codigo: string, base: string): Promise<Buffer> {
  return QRCode.toBuffer(urlBoleto(codigo, base), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 480,
  });
}

/** SVG en línea, para la página del boleto (nítido en cualquier tamaño). */
export async function qrSvg(codigo: string, base: string): Promise<string> {
  return QRCode.toString(urlBoleto(codigo, base), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });
}
