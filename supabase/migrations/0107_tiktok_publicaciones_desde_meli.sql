-- ============================================================================
--  Publicar en TikTok Shop una publicación de MELI COMPLETA como un solo
--  producto (pedido del dueño, 2-oct-2026: «quiero crear en TikTok el
--  listado GT117 a GT122, pero se agrupan en un solo listado aunque son
--  diferentes SKUs»).
--
--  Hasta hoy la cola solo sabía partir de Amazon, un modelo por producto.
--  En MELI hay publicaciones que juntan VARIOS modelos como variantes
--  (MLM2745026941: GT117…GT122, 36 variantes); en TikTok se quieren igual,
--  en un solo producto. `fuente` dice de dónde sale el renglón y `item_id`
--  es la publicación de MELI; para esos renglones `modelo` guarda el item
--  y `colores` la lista de modelos que lleva.
-- ============================================================================

alter table public.tiktok_publicaciones
  add column if not exists fuente  text not null default 'amazon',
  add column if not exists item_id text;

create index if not exists tiktok_publicaciones_item_idx
  on public.tiktok_publicaciones (account_id, item_id)
  where item_id is not null;
