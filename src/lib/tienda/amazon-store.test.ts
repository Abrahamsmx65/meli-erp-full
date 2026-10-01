import { describe, expect, it } from "vitest";
import { esPaginaDeCaptcha, imagenesDeTiendaAmazon } from "./amazon-store";

describe("imágenes de la tienda de marca de Amazon", () => {
  it("saca las imágenes subidas a la tienda, en orden, sin repetir y en su tamaño más grande", () => {
    const html = `
      <img src="https://m.media-amazon.com/images/S/stores-image-uploads-na-prod/0/AmazonStores/A1/abc123.w1500.jpg">
      {"url":"https:\\/\\/m.media-amazon.com\\/images\\/S\\/stores-image-uploads-na-prod\\/0\\/AmazonStores\\/A1\\/abc123.w3000.jpg"}
      <img src="https://m.media-amazon.com/images/S/stores-image-uploads-na-prod/0/AmazonStores/A1/def456.w600.png">
      <img src="https://m.media-amazon.com/images/I/71xyz._AC_SX300_.jpg">
    `;
    const imgs = imagenesDeTiendaAmazon(html);
    expect(imgs.map((i) => i.url)).toEqual([
      "https://m.media-amazon.com/images/S/stores-image-uploads-na-prod/0/AmazonStores/A1/abc123.w3000.jpg",
      "https://m.media-amazon.com/images/S/stores-image-uploads-na-prod/0/AmazonStores/A1/def456.w600.png",
    ]);
    expect(imagenesDeTiendaAmazon(html, 1000).length).toBe(1);
  });

  it("reconoce la página de captcha", () => {
    expect(esPaginaDeCaptcha("<title>Robot Check</title>")).toBe(true);
    expect(esPaginaDeCaptcha("<html>GETAC</html>")).toBe(false);
  });
});
