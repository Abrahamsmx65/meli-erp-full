-- ============================================================================
--  Índices para la lectura paginada (traerTodo) de las tablas grandes.
--
--  traerTodo pide páginas de 1,000 con ORDER BY (account_id, fecha, llave)
--  y LIMIT/OFFSET. Sin un índice con ESE orden, Postgres tenía que volver a
--  ordenar todo el rango en cada página:
--   · amazon_inventario_snapshots no tenía índice por fecha: cada página era
--     un Seq Scan + Sort en disco de ~80 mil filas, 1.2-7 s POR PÁGINA, y la
--     tabla se lee en ~100 páginas cada vez que se abre /pedidos.
--   · ventas_diarias y stock_operaciones tenían (account_id, fecha) pero no
--     el sku/operation_id: un Incremental Sort de ~200 ms por página, y el
--     plan las lee entre 40 y 80 páginas cada vez que se recalcula (cada
--     pocos minutos con el latido).
--  Con (account_id, fecha, llave) cada página es un recorrido del índice
--  sin ordenar nada.
--
--  De paso se quitan los índices que quedan DUPLICADOS (mismo prefijo, o
--  copia exacta, que el linter de Supabase ya marcaba): cada escritura del
--  latido los mantenía de balde.
-- ============================================================================

create index if not exists ventas_diarias_paginacion_idx
  on public.ventas_diarias (account_id, fecha, sku);
create index if not exists stock_operaciones_paginacion_idx
  on public.stock_operaciones (account_id, fecha, operation_id);
create index if not exists stock_snapshots_paginacion_idx
  on public.stock_snapshots (account_id, fecha, sku);
create index if not exists amazon_ventas_diarias_paginacion_idx
  on public.amazon_ventas_diarias (account_id, fecha, seller_sku);
create index if not exists amazon_inventario_snapshots_paginacion_idx
  on public.amazon_inventario_snapshots (account_id, fecha, seller_sku);
create index if not exists amazon_economia_paginacion_idx
  on public.amazon_economia (account_id, fecha, seller_sku);
create index if not exists tiktok_ventas_diarias_paginacion_idx
  on public.tiktok_ventas_diarias (account_id, fecha, sku);

-- (account_id, fecha) ASC queda cubierto por el prefijo del índice nuevo.
drop index if exists public.ventas_fecha_idx;
drop index if exists public.ventas_diarias_cuenta_fecha;
drop index if exists public.stock_snapshots_fecha_idx;
drop index if exists public.stock_snapshots_cuenta_fecha;
drop index if exists public.stock_operaciones_cuenta_fecha;
drop index if exists public.amazon_ventas_fecha_idx;
drop index if exists public.amazon_ventas_diarias_cuenta_fecha;
drop index if exists public.amazon_economia_cuenta_fecha;
drop index if exists public.tiktok_ventas_fecha_idx;

analyze public.ventas_diarias;
analyze public.stock_operaciones;
analyze public.stock_snapshots;
analyze public.amazon_ventas_diarias;
analyze public.amazon_inventario_snapshots;
analyze public.amazon_economia;
analyze public.tiktok_ventas_diarias;
