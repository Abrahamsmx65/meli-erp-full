-- ============================================================================
--  Caché del plan calculado.
--
--  Calcular el plan es caro: hay que traer decenas de miles de renglones de
--  ventas y movimientos, reconstruir 90 días de stock por SKU y correr el
--  optimizador de cajas. Hacerlo en cada carga de pantalla es absurdo: los
--  insumos solo cambian cuando sincronizas, importas o tocas un amarre.
--
--  Aquí se guarda el resultado ya masticado. La pantalla lee un renglón.
-- ============================================================================

create table if not exists plan_cache (
  account_id  uuid primary key references meli_accounts (id) on delete cascade,
  generado_en timestamptz not null default now(),
  -- false cuando algo cambió y el plan guardado ya no refleja la realidad
  vigente     boolean not null default true,
  -- qué lo invalidó, para poder decírselo al usuario
  motivo      text,
  ms_calculo  integer,
  datos       jsonb not null
);

alter table plan_cache enable row level security;
drop policy if exists plan_cache_mias on plan_cache;
create policy plan_cache_mias on plan_cache
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- ---------------------------------------------------------------------------
-- Índices que faltaban.
--
-- Las lecturas del plan siempre filtran por cuenta y fecha. Sin estos, cada
-- recálculo hace recorridos completos de tablas que ya pasan de 30 mil
-- renglones y que crecen todos los días.
-- ---------------------------------------------------------------------------
create index if not exists ventas_cuenta_fecha_idx
  on ventas_diarias (account_id, fecha desc);

create index if not exists stock_ops_cuenta_fecha_idx
  on stock_operaciones (account_id, fecha desc);

create index if not exists stock_snapshots_cuenta_fecha_idx
  on stock_snapshots (account_id, fecha desc);

create index if not exists skus_cuenta_activo_idx
  on skus (account_id) where activo;
