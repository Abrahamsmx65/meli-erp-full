# Tienda en línea de GETAC

Proyecto **aparte** del ERP (su propio `package.json` y su propio despliegue
en Vercel con Root Directory = `tienda`), pero sobre la **misma base** de
Supabase. Vende del **mismo almacén que TikTok Shop**: el kardex de TikTok del
ERP (`tiktok_inventario`). Lo que se aparta aquí deja de ofrecerse en TikTok
en el acto, y lo que vende TikTok deja de ofrecerse aquí.

## Cómo se reparte el trabajo

| Qué | Dónde |
|---|---|
| Catálogo (fotos, descripción, colores, tallas, precio) | El ERP lo copia de TikTok a `tienda_productos` / `tienda_variantes` (`src/lib/servicios/tienda-catalogo.ts`; cron de TikTok y botón en ERP → TikTok → Tienda en línea). |
| Existencia | `tienda_disponibles` (RPC): la misma regla con la que se publica a TikTok (menor entre kardex y estante de Industher, solo SKUs contados) menos lo apartado por TikTok y por la tienda. |
| Apartar al pagar | `tienda_crear_pedido` (RPC) bloquea los renglones del kardex: dos compradores no se llevan el último par. El precio sale del catálogo, nunca del navegador. |
| Pago | Mercado Pago Checkout Pro (tarjeta, meses, OXXO, SPEI). El aviso solo dice qué pago leer; el pago se lee de MP con nuestra llave y tiene que ser de ese pedido y cubrir su total. |
| Avisar a TikTok | La tienda llama `POST {ERP_URL}/api/tiktok/tienda/aviso` y el ERP publica el disponible nuevo. El cron de TikTok (15 min) es la red de seguridad. |
| Despachar | ERP → TikTok → **Tienda en línea**: guía, «Marcar enviado» (salida en el kardex con el folio GW…, salida al 3PL de Industher), cancelar con reembolso. |
| Pedidos sin pagar | Se apartan 45 min; con OXXO/SPEI pendiente, 72 h. `/api/cron/expirar` (cada 10 min) los suelta. Un pago que llega tarde vuelve a apartar si aún hay pares; si no, el pedido queda «sin stock» para devolver el dinero. |
| Cuentas de cliente | Sin contraseña: código de 6 dígitos al correo (Resend). Tablas propias `tienda_clientes`, `tienda_codigos`, `tienda_sesiones`; un cliente no es usuario del ERP. |

## Variables de entorno (Vercel → proyecto de la tienda)

| Variable | Qué es |
|---|---|
| `SUPABASE_URL` | La misma del ERP. |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave service_role (solo servidor; las tablas `tienda_*` no tienen políticas públicas). |
| `TIENDA_ACCOUNT_ID` | `meli_accounts.id` de la cuenta cuyo almacén TikTok se vende. |
| `TIENDA_URL` | La URL pública, p. ej. `https://getac.mx` (Mercado Pago regresa aquí). |
| `MP_ACCESS_TOKEN` | Access token de PRODUCCIÓN de Mercado Pago (Tus integraciones → credenciales). |
| `TIENDA_SESION_SECRET` | Cadena larga al azar (firma de sesiones y códigos). |
| `TIENDA_SECRET` | Cadena larga al azar, **la misma** en el ERP: autoriza el aviso al ERP. |
| `ERP_URL` | `https://meli-erp-full.vercel.app` (por omisión). |
| `CRON_SECRET` | Para `/api/cron/expirar`. |
| `RESEND_API_KEY`, `CORREO_REMITENTE` | Correos de código y de pago. El remitente debe ser de un dominio verificado en Resend: `onboarding@resend.dev` solo entrega al dueño de la cuenta de Resend. |
| `ENVIO_COSTO`, `ENVIO_GRATIS_DESDE` | Costo de envío (149 por omisión) y desde cuánto es gratis (999 por omisión). |

En el **ERP** van `TIENDA_SECRET` (la misma), `TIENDA_URL` (para el enlace de
la pantalla) y `MP_ACCESS_TOKEN` (para devolver el dinero al cancelar).

## Banners

Las imágenes en `public/banners/` (jpg, png, webp) salen en la portada en
orden alfabético (`01-temporada.jpg`, `02-…`). Ancho recomendado 1920 px.

## Desarrollo

```
npm install
npm test          # reglas puras
npx tsc --noEmit  # tipos
npm run dev
```
