-- Índices para las lecturas calientes.
--
-- La paginación de traerTodo ahora ordena por la llave primaria (índice
-- gratis), pero las consultas por RANGO DE FECHA (el monitor de ventas, los
-- insumos del plan, los resúmenes de Amazon) filtran por account_id + fecha
-- y la llave primaria trae el sku en medio: sin estos índices, cada rango
-- recorre la tabla completa de la cuenta.
create index if not exists ventas_diarias_cuenta_fecha
  on public.ventas_diarias (account_id, fecha);

create index if not exists amazon_ventas_diarias_cuenta_fecha
  on public.amazon_ventas_diarias (account_id, fecha);

create index if not exists amazon_economia_cuenta_fecha
  on public.amazon_economia (account_id, fecha);

create index if not exists stock_operaciones_cuenta_fecha
  on public.stock_operaciones (account_id, fecha);

create index if not exists stock_snapshots_cuenta_fecha
  on public.stock_snapshots (account_id, fecha);
