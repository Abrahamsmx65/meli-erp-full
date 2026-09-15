-- Dinero de Amazon EXACTO: los eventos financieros de la Finances API
-- (SP-API /finances/v0), guardados uno por uno y crudos, agrupados por su
-- GRUPO DE LIQUIDACIÓN (settlement).
--
-- Hasta hoy el dinero de Amazon entraba por tres agregados (reporte de
-- órdenes, reporte de liquidación con el neto colapsado en una columna y
-- SKU Economics, que es una estimación de Amazon y para julio solo cubría
-- ~15 % de las unidades). Nada decía, por pedido, cuánto fue comisión,
-- tarifa de FBA, IVA retenido o promoción. La Finances API sí: cada evento
-- trae esos montos con su nombre.
--
-- El número de control es el total del grupo (`OriginalTotal`): un grupo
-- cerrado ya no cambia y la suma de todos sus eventos tiene que dar ese
-- total. `cuadra` lo dice; si no cuadra, falta o sobra algo y se declara.

create table if not exists public.amazon_finanzas_grupos (
  account_id      uuid not null references public.amazon_accounts(id) on delete cascade,
  grupo_id        text not null,
  inicio          timestamptz,
  fin             timestamptz,
  estado          text,
  transferencia   text,
  transferido_en  timestamptz,
  total_original  numeric,
  moneda          text,
  saldo_inicial   numeric,
  -- avance de la lectura
  paginas         integer not null default 0,
  eventos         integer not null default 0,
  sin_clasificar  integer not null default 0,
  suma_eventos    numeric,
  completo        boolean not null default false,
  cuadra          boolean,
  token_siguiente text,
  leido_en        timestamptz,
  crudo           jsonb,
  actualizado_en  timestamptz not null default now(),
  primary key (account_id, grupo_id)
);

create table if not exists public.amazon_finanzas_eventos (
  account_id       uuid not null references public.amazon_accounts(id) on delete cascade,
  -- huella del JSON crudo: releer el mismo grupo reescribe lo mismo
  clave            text not null,
  grupo_id         text not null,
  lista            text not null,
  amazon_order_id  text,
  posted_en        timestamptz,
  -- lo que el evento suma o resta al depósito (null si no se supo leer)
  monto            numeric,
  base             numeric,
  impuesto         numeric,
  descripcion      text,
  -- cascada de los eventos con forma de envío (venta, reembolso, garantía…)
  principal        numeric,
  impuesto_cobrado numeric,
  otros_cargos     numeric,
  comision         numeric,
  fba              numeric,
  otras_tarifas    numeric,
  retenido         numeric,
  promociones      numeric,
  unidades         integer,
  -- la misma cascada por SKU: [{sku, unidades, principal, …, neto}]
  renglones        jsonb,
  clasificado      boolean not null default true,
  crudo            jsonb not null,
  leido_en         timestamptz not null default now(),
  primary key (account_id, clave)
);

create index if not exists amazon_finanzas_eventos_posted_idx
  on public.amazon_finanzas_eventos (account_id, posted_en);
create index if not exists amazon_finanzas_eventos_grupo_idx
  on public.amazon_finanzas_eventos (account_id, grupo_id);
create index if not exists amazon_finanzas_eventos_orden_idx
  on public.amazon_finanzas_eventos (account_id, amazon_order_id)
  where amazon_order_id is not null;

alter table public.amazon_finanzas_grupos enable row level security;
alter table public.amazon_finanzas_eventos enable row level security;

drop policy if exists amazon_finanzas_grupos_mias on public.amazon_finanzas_grupos;
create policy amazon_finanzas_grupos_mias on public.amazon_finanzas_grupos
  for select using (es_mi_cuenta_amazon(account_id));

drop policy if exists amazon_finanzas_eventos_mias on public.amazon_finanzas_eventos;
create policy amazon_finanzas_eventos_mias on public.amazon_finanzas_eventos
  for select using (es_mi_cuenta_amazon(account_id));

-- ---------------------------------------------------------------------------
-- Sumas en Postgres (nunca bajar la tabla cruda a Node). Rango acotado por
-- los dos lados sobre la fecha de ASIENTO en hora de México, y ORDER BY
-- estable para poder paginar.
-- ---------------------------------------------------------------------------

-- Por SKU: la cascada de las ventas y la de los reembolsos por separado.
create or replace function amazon_finanzas_por_sku(
  p_account uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  seller_sku        text,
  lista             text,
  eventos           bigint,
  unidades          numeric,
  principal         numeric,
  impuesto_cobrado  numeric,
  otros_cargos      numeric,
  comision          numeric,
  fba               numeric,
  otras_tarifas     numeric,
  retenido          numeric,
  promociones       numeric,
  neto              numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- La sesión del dueño (RLS) o el fondo con service_role (precálculo).
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      coalesce(r.value->>'sku', '')                        as seller_sku,
      e.lista,
      count(*)                                             as eventos,
      sum((r.value->>'unidades')::numeric)                 as unidades,
      sum((r.value->>'principal')::numeric)                as principal,
      sum((r.value->>'impuestoCobrado')::numeric)          as impuesto_cobrado,
      sum((r.value->>'otrosCargos')::numeric)              as otros_cargos,
      sum((r.value->>'comision')::numeric)                 as comision,
      sum((r.value->>'fba')::numeric)                      as fba,
      sum((r.value->>'otrasTarifas')::numeric)             as otras_tarifas,
      sum((r.value->>'retenido')::numeric)                 as retenido,
      sum((r.value->>'promociones')::numeric)              as promociones,
      sum((r.value->>'neto')::numeric)                     as neto
    from amazon_finanzas_eventos e
    cross join lateral jsonb_array_elements(coalesce(e.renglones, '[]'::jsonb)) r
    where e.account_id = p_account
      and e.renglones is not null
      and (e.posted_en at time zone 'America/Mexico_City')::date >= p_desde
      and (e.posted_en at time zone 'America/Mexico_City')::date <= p_hasta
    group by coalesce(r.value->>'sku', ''), e.lista
    order by 1, 2;
end;
$$;

revoke all on function amazon_finanzas_por_sku(uuid, date, date) from public, anon;
grant execute on function amazon_finanzas_por_sku(uuid, date, date) to authenticated, service_role;

-- Los demás eventos (publicidad con su IVA, cargos de servicio, ajustes,
-- retenciones del periodo…) por lista.
create or replace function amazon_finanzas_otros(
  p_account uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  lista          text,
  eventos        bigint,
  monto          numeric,
  base           numeric,
  impuesto       numeric,
  sin_clasificar bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- La sesión del dueño (RLS) o el fondo con service_role (precálculo).
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      e.lista,
      count(*)                                          as eventos,
      sum(e.monto)                                      as monto,
      sum(e.base)                                       as base,
      sum(e.impuesto)                                   as impuesto,
      count(*) filter (where not e.clasificado)         as sin_clasificar
    from amazon_finanzas_eventos e
    where e.account_id = p_account
      and e.renglones is null
      and (e.posted_en at time zone 'America/Mexico_City')::date >= p_desde
      and (e.posted_en at time zone 'America/Mexico_City')::date <= p_hasta
    group by e.lista
    order by e.lista;
end;
$$;

revoke all on function amazon_finanzas_otros(uuid, date, date) from public, anon;
grant execute on function amazon_finanzas_otros(uuid, date, date) to authenticated, service_role;

-- Cierre de un grupo: la suma de sus eventos guardados, para cuadrarla
-- contra el total de Amazon. Solo la ingesta (service_role) la llama.
create or replace function amazon_finanzas_suma_grupo(
  p_account uuid,
  p_grupo   text
)
returns table (
  suma           numeric,
  eventos        bigint,
  sin_clasificar bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(e.monto), 0)::numeric        as suma,
         count(*)                                   as eventos,
         count(*) filter (where not e.clasificado)  as sin_clasificar
  from amazon_finanzas_eventos e
  where e.account_id = p_account
    and e.grupo_id = p_grupo;
$$;

revoke all on function amazon_finanzas_suma_grupo(uuid, text) from public, anon, authenticated;
grant execute on function amazon_finanzas_suma_grupo(uuid, text) to service_role;

-- Cobertura: los grupos de liquidación que tocan el rango y su estado.
create or replace function amazon_finanzas_cobertura(
  p_account uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  grupo_id       text,
  inicio         timestamptz,
  fin            timestamptz,
  estado         text,
  total_original numeric,
  suma_eventos   numeric,
  eventos        integer,
  sin_clasificar integer,
  completo       boolean,
  cuadra         boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- La sesión del dueño (RLS) o el fondo con service_role (precálculo).
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select g.grupo_id, g.inicio, g.fin, g.estado, g.total_original, g.suma_eventos,
           g.eventos, g.sin_clasificar, g.completo, g.cuadra
    from amazon_finanzas_grupos g
    where g.account_id = p_account
      and coalesce(g.moneda, 'MXN') = 'MXN'
      and g.inicio is not null
      and (g.inicio at time zone 'America/Mexico_City')::date <= p_hasta
      and (coalesce(g.fin, now()) at time zone 'America/Mexico_City')::date >= p_desde
    order by g.inicio;
end;
$$;

revoke all on function amazon_finanzas_cobertura(uuid, date, date) from public, anon;
grant execute on function amazon_finanzas_cobertura(uuid, date, date) to authenticated, service_role;
