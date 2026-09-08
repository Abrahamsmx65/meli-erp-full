-- ============================================================================
--  Caché genérico de resultados masticados (lado calzado / Amazon).
--
--  El mismo patrón que plan_cache / inventario_cache / yz_cache, para las
--  pantallas que quedaban calculando por visita: el monitor y la publicidad
--  de Amazon (bajaban ~30 mil renglones de venta por render), el contenido
--  de Amazon (el catálogo completo de listings), el sheet de pedidos
--  pendientes (se descargaba de Google EN VIVO en cada visita a Cargar
--  pedidos) y la sugerencia de compra a China. Una fila por (cuenta, clave)
--  con el resultado aplanado; TTL corto o invalidación explícita, y SIEMPRE
--  el cálculo en vivo como respaldo.
--
--  Sin FK a una tabla de cuentas a propósito: la clave puede colgarse de la
--  cuenta de MELI o de la de Amazon según la pantalla. La RLS acepta a la
--  dueña de cualquiera de las dos.
-- ============================================================================

create table if not exists app_cache (
  account_id  uuid not null,
  clave       text not null,
  generado_en timestamptz not null default now(),
  vigente     boolean not null default true,
  motivo      text,
  ms_calculo  integer,
  datos       jsonb not null,
  primary key (account_id, clave)
);

alter table app_cache enable row level security;
drop policy if exists app_cache_mias on app_cache;
create policy app_cache_mias on app_cache
  for all
  using (es_mi_cuenta(account_id) or es_mi_cuenta_amazon(account_id))
  with check (es_mi_cuenta(account_id) or es_mi_cuenta_amazon(account_id));
