-- ============================================================================
--  Fundas y corte general con datos ya masticados.
--
--  El lado de fundas no tenía NI UNA tabla de caché: cada visita a Pedidos a
--  China, Envíos a Full o Bodega bajaba el catálogo completo (~18 mil
--  variantes) dos o tres veces y re-agregaba todo en Node, con hasta 120 s
--  de cómputo por clic. Y el corte general recalculaba los TRES canales en
--  cada render (hasta 300 s). Aquí llega el mismo patrón que ya salvó al
--  calzado (plan_cache / inventario_cache):
--
--  1. `yz_cache`: resultados masticados por clave ("compras", "plan",
--     "inventario", "amarre", "ads:YYYY-MM"). El cron de netos los deja
--     precalculados; los syncs y las escrituras los invalidan.
--  2. `consolidado_cache`: el corte general del periodo, con TTL corto; la
--     página deja de correr calzado + fundas + Amazon en cada visita.
--  3. `yz_ultimas_ventas`: la última venta por SKU EN UNA SOLA llamada y con
--     filtro de fecha. La versión anterior (yz_ultima_venta) agregaba TODA
--     yz_ventas_diarias sin filtro y además se paginaba: PostgREST
--     re-ejecutaba el agregado completo ~18 veces con OFFSET creciente en
--     cada apertura de Pedidos y de Envíos. Era el principal culpable de
--     que esas pantallas se trabaran.
-- ============================================================================

create table if not exists yz_cache (
  account_id  uuid not null references yz_cuentas (id) on delete cascade,
  clave       text not null,
  generado_en timestamptz not null default now(),
  vigente     boolean not null default true,
  motivo      text,
  ms_calculo  integer,
  datos       jsonb not null,
  primary key (account_id, clave)
);

alter table yz_cache enable row level security;
drop policy if exists yz_cache_mias on yz_cache;
create policy yz_cache_mias on yz_cache
  for all using (es_mi_cuenta_yz(account_id)) with check (es_mi_cuenta_yz(account_id));

create table if not exists consolidado_cache (
  account_id  uuid not null references meli_accounts (id) on delete cascade,
  periodo     text not null,
  generado_en timestamptz not null default now(),
  ms_calculo  integer,
  datos       jsonb not null,
  primary key (account_id, periodo)
);

alter table consolidado_cache enable row level security;
drop policy if exists consolidado_cache_mias on consolidado_cache;
create policy consolidado_cache_mias on consolidado_cache
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- La última venta por SKU, en UN solo objeto JSON (sin paginar) y solo desde
-- p_desde: para descontinuados solo importa si vendió dentro de la ventana.
create or replace function yz_ultimas_ventas(p_account uuid, p_desde date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.sku, t.ultima), '{}'::jsonb)
  from (
    select v.sku, max(v.fecha)::text as ultima
    from yz_ventas_diarias v
    where v.account_id = p_account and v.fecha >= p_desde
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
    group by v.sku
  ) t;
$$;

revoke all on function yz_ultimas_ventas(uuid, date) from public, anon;
grant execute on function yz_ultimas_ventas(uuid, date) to authenticated, service_role;
