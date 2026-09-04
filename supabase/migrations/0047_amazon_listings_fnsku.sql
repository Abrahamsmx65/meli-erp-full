-- ============================================================================
--  Amazon: FNSKU en el catálogo de publicaciones.
--
--  El FNSKU (el código que va en la etiqueta de FBA) solo se sacaba del
--  reporte de inventario FBA, que trae nada más lo que Amazon tiene o tuvo
--  en sus bodegas hace poco. Una publicación de FBA sin inventario —agotada
--  y ya "Inactive", o nueva y todavía sin primer envío— desaparece de ese
--  reporte aunque en Seller Central siga teniendo su FNSKU, y entonces
--  /etiquetas decía que no estaba en Amazon (MY2304-PURPLE-23-MX).
--
--  Se pregunta por SKU al API de publicaciones (Listings Items,
--  searchListingsItems con includedData=summaries), que lo devuelve haya o
--  no inventario, y se guarda aquí. `fnsku_consultado_en` evita volver a
--  preguntar por lo que Amazon ya contestó (con o sin FNSKU) hasta que pase
--  una semana.
-- ============================================================================

alter table public.amazon_listings
  add column if not exists fnsku               text,
  add column if not exists fnsku_consultado_en timestamptz;

-- Lo que falta por consultar se busca cada hora: que sea barato.
create index if not exists amazon_listings_fnsku_pendiente_idx
  on public.amazon_listings (account_id, fnsku_consultado_en)
  where fnsku is null;
