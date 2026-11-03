-- Agregar colores a un listado que YA existe en TikTok (pedido del dueño,
-- 15-oct-2026: «quiero poder agregar colores nuevos a listados ya hechos en
-- TikTok que aumenten colores en Amazon, por ejemplo el GT125»). Un renglón
-- de la cola con `producto_destino` no crea un producto nuevo: le agrega sus
-- colores como variantes al producto de TikTok con ese id (edición parcial).
alter table public.tiktok_publicaciones
  add column if not exists producto_destino text;
comment on column public.tiktok_publicaciones.producto_destino is
  'product_id de TikTok al que se le AGREGAN los colores como variantes nuevas (partial_edit). null = se crea un producto nuevo.';
