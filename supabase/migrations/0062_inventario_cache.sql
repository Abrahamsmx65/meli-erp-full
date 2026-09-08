-- ============================================================================
--  Caché de la vista de inventario (bodega + Full), como plan_cache.
--
--  Cruzar bodega con Full lee siete tablas y arma todas las cajas físicas:
--  era lo que hacía lentas a Bodega y a Planificación China en CADA visita
--  (el caché de 60 s en memoria no se comparte entre instancias de Vercel).
--  Ahora el resultado vive masticado aquí; lo invalida `invalidar()` (los
--  mismos disparos que ya invalidan al plan: importar existencias, cargar
--  pedidos, amarres, corridas, Industher) y el latido lo deja precalculado.
-- ============================================================================

create table if not exists inventario_cache (
  account_id  uuid primary key references meli_accounts (id) on delete cascade,
  generado_en timestamptz not null default now(),
  vigente     boolean not null default true,
  motivo      text,
  ms_calculo  integer,
  datos       jsonb not null
);

alter table inventario_cache enable row level security;
drop policy if exists inventario_cache_mias on inventario_cache;
create policy inventario_cache_mias on inventario_cache
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
