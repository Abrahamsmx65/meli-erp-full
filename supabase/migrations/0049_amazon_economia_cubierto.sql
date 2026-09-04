-- ============================================================================
--  amazon_economia: índice CUBIERTO para la suma por SKU.
--
--  `amazon_economia_por_sku` (Publicidad y Ventas de Amazon) suma 30 días
--  de economía por SKU: ~160 mil renglones. Con el índice a secas Postgres
--  encontraba las llaves en el índice pero iba a la tabla por cada renglón
--  (165 mil lecturas de buffer, 5.6 s medidos; hasta 7.8 s bajo carga).
--  Supabase corta la consulta a los 8 s, el error se tragaba y la pantalla
--  decía "Sin datos de publicidad en el rango" con la publicidad cargada.
--
--  Con las cinco columnas que suma la función dentro del índice, la suma
--  sale del índice sin tocar la tabla (Index Only Scan). Sustituye al
--  índice de 0047 (mismo prefijo). La tabla se rescribe a diario, así que
--  también se le baja el umbral del autovacuum, como a las de 0048.
-- ============================================================================

drop index if exists public.amazon_economia_paginacion_idx;
create index amazon_economia_paginacion_idx
  on public.amazon_economia (account_id, fecha, seller_sku)
  include (unidades, ventas, tarifas, publicidad, neto);

alter table public.amazon_economia
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
