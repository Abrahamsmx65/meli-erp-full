-- ============================================================================
--  Tienda en línea: las MISMAS fotos de Amazon y la categoría del modelo
--  (pedido del dueño, 1-oct-2026: «copia todo de la página de Amazon, las
--  fotos y categorías… y principalmente las mismas imágenes»).
--
--  · `fotos_amazon`: { "<color como lo nombra TikTok>": [url, …] } con las
--    fotos de la ficha capturada en Amazon (Listings Items: principal y
--    other_1…8, en ese orden). La tienda las enseña ANTES que las de TikTok.
--  · `bullets`: los puntos clave de la ficha de Amazon.
--  · `categoria`: la de Productos y costos (productos_config) del modelo.
-- ============================================================================
alter table public.tienda_productos
  add column if not exists fotos_amazon jsonb not null default '{}'::jsonb,
  add column if not exists bullets jsonb not null default '[]'::jsonb,
  add column if not exists categoria text,
  add column if not exists amazon_leido_en timestamptz;
