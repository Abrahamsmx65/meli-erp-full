-- ============================================================================
--  Los índices de paginación de 0047, ahora CUBIERTOS (INCLUDE).
--
--  Medido en producción sobre ventas_diarias (página con OFFSET 30,000):
--   · sin índice con el orden de la paginación:   204 ms (Incremental Sort)
--   · con (account_id, fecha, sku) a secas:      1,487 ms — PEOR: el orden
--     del índice no coincide con el orden físico de la tabla (los renglones
--     se escriben por día y los del día se actualizan a cada minuto), así
--     que cada renglón era un salto a una página distinta del heap
--     (29 mil lecturas de buffer contra 7 mil).
--   · con INCLUDE de las columnas que se leen:      26 ms — Index Only Scan:
--     todo sale del índice, sin tocar la tabla.
--
--  Se incluyen exactamente las columnas que piden los lectores paginados
--  (traerTodo en repos.ts, ventas-monitor.ts, historial.ts, publicidad.ts,
--  fba.ts, amazon-monitor.ts, tiktok-panel.ts, /tiktok/ventas). Un lector
--  que pida otra columna sigue funcionando: usa el índice para el orden y
--  va a la tabla por el resto.
--
--  Para que el Index Only Scan siga sirviendo hace falta que el mapa de
--  visibilidad esté al día, y eso lo pone VACUUM. Estas tablas se
--  actualizan a cada minuto (el latido) y el autovacuum por defecto (20 %
--  de renglones muertos) tardaba semanas en pasar: se le baja el umbral
--  al 2 % en las tablas que se paginan.
--
--  amazon_economia se queda con el índice a secas: ya no se pagina desde
--  el código (la agrega `amazon_economia_por_sku` en la base).
-- ============================================================================

drop index if exists public.ventas_diarias_paginacion_idx;
drop index if exists public.stock_operaciones_paginacion_idx;
drop index if exists public.stock_snapshots_paginacion_idx;
drop index if exists public.amazon_ventas_diarias_paginacion_idx;
drop index if exists public.amazon_inventario_snapshots_paginacion_idx;
drop index if exists public.tiktok_ventas_diarias_paginacion_idx;

create index ventas_diarias_paginacion_idx
  on public.ventas_diarias (account_id, fecha, sku)
  include (unidades, ordenes, importe, comision, neto);
create index stock_operaciones_paginacion_idx
  on public.stock_operaciones (account_id, fecha, operation_id)
  include (sku, tipo, delta_disponible, resultado_disponible);
create index stock_snapshots_paginacion_idx
  on public.stock_snapshots (account_id, fecha, sku)
  include (disponible, en_transferencia, origen);
create index amazon_ventas_diarias_paginacion_idx
  on public.amazon_ventas_diarias (account_id, fecha, seller_sku)
  include (unidades, ordenes, importe);
create index amazon_inventario_snapshots_paginacion_idx
  on public.amazon_inventario_snapshots (account_id, fecha, seller_sku)
  include (disponible);
create index tiktok_ventas_diarias_paginacion_idx
  on public.tiktok_ventas_diarias (account_id, fecha, sku)
  include (unidades, ordenes, importe);

alter table public.ventas_diarias
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.stock_operaciones
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.stock_snapshots
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.amazon_ventas_diarias
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.amazon_inventario_snapshots
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.tiktok_ventas_diarias
  set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
