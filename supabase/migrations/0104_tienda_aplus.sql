-- ============================================================================
--  Tienda en línea: contenido A+ de Amazon en la ficha del producto (pedido
--  del dueño, 1-oct-2026: «integrar el contenido A+ abajo para que se vea
--  bonito»). Las imágenes A+ de la página del producto en Amazon, en orden.
-- ============================================================================
alter table public.tienda_productos
  add column if not exists aplus jsonb not null default '[]'::jsonb,
  add column if not exists asin text;
