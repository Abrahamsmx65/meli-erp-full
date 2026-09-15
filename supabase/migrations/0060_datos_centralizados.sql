-- ============================================================================
--  Datos centralizados: la pantalla lee la base, no vuelve a pedir a MELI.
--
--  Tres piezas, todas con el mismo espíritu que plan_cache (una vez se
--  calcula/sincroniza, muchas veces se lee):
--
--  1. Product Ads sincronizado a `publicidad_diaria` (un renglón por anuncio
--     por día). Hasta hoy /ventas, /publicidad y /ventas/cortes le pedían a
--     MELI el barrido completo de anuncios EN CADA RENDER (paginado de 50 en
--     50, hasta 400 páginas): era la llamada externa más cara del sistema.
--     El latido sincroniza; la pantalla suma con `publicidad_resumen_items`.
--
--  2. Las agregaciones del monitor de ventas en Postgres
--     (`ventas_resumen_sku` y `ventas_totales_dia`): bajar decenas de miles
--     de renglones de `ventas_diarias` para sumarlos en Node era el costo
--     más alto de abrir /ventas, y /publicidad los volvía a bajar aparte.
--
--  3. `plan_fba_cache`: el plan de FBA (optimizador de cajas incluido) se
--     recalculaba completo en cada visita a /amazon; ahora se guarda
--     masticado como el plan de Full y se invalida cuando cambian sus
--     insumos (sincronización de Amazon, bodega, corridas, amarres).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Product Ads por día
-- ---------------------------------------------------------------------------

create table if not exists publicidad_diaria (
  account_id   uuid not null references meli_accounts (id) on delete cascade,
  fecha        date not null,
  item_id      text not null,
  gasto        numeric not null default 0,
  clicks       integer not null default 0,
  impresiones  integer not null default 0,
  unidades_ads numeric not null default 0,
  venta_ads    numeric not null default 0,
  -- estado/campaña/título del anuncio TAL CUAL ese día; el resumen usa los
  -- del día más reciente sincronizado.
  estado       text,
  campana_id   text,
  titulo       text,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, fecha, item_id)
);

alter table publicidad_diaria enable row level security;
drop policy if exists publicidad_diaria_mias on publicidad_diaria;
create policy publicidad_diaria_mias on publicidad_diaria
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

create index if not exists publicidad_diaria_cuenta_fecha_idx
  on publicidad_diaria (account_id, fecha desc);

-- Cobertura de la sincronización: los días [desde, hasta] ya están en la
-- tabla SIN huecos. La pantalla solo lee de la base cuando su rango cabe
-- completo aquí; si no, cae al API en vivo como siempre (nunca datos a
-- medias sin avisar).
create table if not exists publicidad_sync (
  account_id     uuid primary key references meli_accounts (id) on delete cascade,
  desde          date not null,
  hasta          date not null,
  actualizado_en timestamptz not null default now(),
  error          text
);

alter table publicidad_sync enable row level security;
drop policy if exists publicidad_sync_mias on publicidad_sync;
create policy publicidad_sync_mias on publicidad_sync
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- El resumen por anuncio de un rango, sumado en la base. El estado, la
-- campaña y el título salen del día MÁS RECIENTE que se haya sincronizado
-- de ese anuncio (no del rango): las recomendaciones preguntan cómo está el
-- anuncio HOY, igual que hacía el API en vivo.
create or replace function publicidad_resumen_items(p_account uuid, p_desde date, p_hasta date)
returns table (
  item_id text, gasto numeric, clicks bigint, impresiones bigint,
  unidades_ads numeric, venta_ads numeric, estado text, campana_id text, titulo text
)
language sql stable security definer set search_path = public as $$
  with permitido as (
    select (auth.role() = 'service_role' or es_mi_cuenta(p_account)) as ok
  ),
  d as (
    select p.item_id, p.gasto, p.clicks, p.impresiones, p.unidades_ads, p.venta_ads
    from publicidad_diaria p, permitido
    where permitido.ok and p.account_id = p_account
      and p.fecha >= p_desde and p.fecha <= p_hasta
  ),
  ult as (
    select distinct on (p.item_id) p.item_id, p.estado, p.campana_id, p.titulo
    from publicidad_diaria p, permitido
    where permitido.ok and p.account_id = p_account
    order by p.item_id, p.fecha desc
  )
  select d.item_id, sum(d.gasto), sum(d.clicks)::bigint, sum(d.impresiones)::bigint,
         sum(d.unidades_ads), sum(d.venta_ads), u.estado, u.campana_id, u.titulo
  from d join ult u using (item_id)
  group by d.item_id, u.estado, u.campana_id, u.titulo;
$$;

revoke all on function publicidad_resumen_items(uuid, date, date) from public, anon;
grant execute on function publicidad_resumen_items(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Agregaciones del monitor de ventas
-- ---------------------------------------------------------------------------

-- Un renglón por SKU con las sumas que el monitor y el panel de publicidad
-- calculaban en Node tras bajar la tabla cruda. La regla del neto es la de
-- siempre: el depósito REAL de Mercado Pago cuando ya llegó y es creíble
-- (> 0); si no, importe − comisión. El filtro de fechas NO tiene tope
-- superior a propósito: el monitor siempre cargaba desde el periodo previo
-- hacia adelante, y un SKU con venta después del rango sigue apareciendo
-- (con ceros) como aparecía antes.
create or replace function ventas_resumen_sku(
  p_account uuid, p_desde date, p_hasta date,
  p_prev_desde date, p_prev_hasta date, p_hoy date
)
returns table (
  sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric,
  neto_resuelto numeric, importe_neto_real numeric, comision_neto_real numeric,
  neto_real numeric, unidades_hoy bigint, unidades_prev bigint
)
language sql stable security definer set search_path = public as $$
  select v.sku,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(case when v.neto is not null and v.neto > 0 then v.neto
                      else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
             filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto > 0), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto > 0), 0),
    coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto > 0), 0),
    coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= least(p_prev_desde, p_desde)
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  group by v.sku;
$$;

-- Totales por día (las fichas de Hoy / Ayer / Periodo).
create or replace function ventas_totales_dia(p_account uuid, p_desde date, p_hasta date)
returns table (fecha date, unidades bigint, ordenes bigint, importe numeric)
language sql stable security definer set search_path = public as $$
  select v.fecha,
    coalesce(sum(v.unidades), 0)::bigint,
    coalesce(sum(v.ordenes), 0)::bigint,
    coalesce(sum(v.importe), 0)
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  group by v.fecha order by v.fecha;
$$;

revoke all on function ventas_resumen_sku(uuid, date, date, date, date, date) from public, anon;
revoke all on function ventas_totales_dia(uuid, date, date) from public, anon;
grant execute on function ventas_resumen_sku(uuid, date, date, date, date, date) to authenticated, service_role;
grant execute on function ventas_totales_dia(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Caché del plan de FBA
-- ---------------------------------------------------------------------------

create table if not exists plan_fba_cache (
  account_id      uuid not null references amazon_accounts (id) on delete cascade,
  -- el periodo de venta con el que se calculó (7, 15, 30, 60, 90, 365)
  dias            integer not null,
  -- la cuenta de MELI cuya bodega alimenta el plan, para poder invalidar
  -- desde el lado MELI (existencias, corridas, amarres, envíos)
  meli_account_id uuid references meli_accounts (id) on delete cascade,
  generado_en     timestamptz not null default now(),
  vigente         boolean not null default true,
  motivo          text,
  ms_calculo      integer,
  datos           jsonb not null,
  primary key (account_id, dias)
);

alter table plan_fba_cache enable row level security;
drop policy if exists plan_fba_cache_mias on plan_fba_cache;
create policy plan_fba_cache_mias on plan_fba_cache
  for all using (es_mi_cuenta_amazon(account_id)) with check (es_mi_cuenta_amazon(account_id));

create index if not exists plan_fba_cache_meli_idx
  on plan_fba_cache (meli_account_id);
