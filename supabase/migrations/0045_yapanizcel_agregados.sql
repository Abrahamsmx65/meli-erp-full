-- ============================================================================
--  Sumas de ventas y fotos de stock de YAPANIZCEL hechas EN la base.
--
--  yz_ventas_diarias crece ~4,200 renglones por día; traer 30 días al
--  servidor de páginas (126 mil renglones, de mil en mil) tumbaba Pedidos a
--  China, Envíos y Ventas por tiempo. Estas funciones devuelven lo ya sumado
--  por SKU (y por bloque: última semana, la anterior, el resto), que es lo
--  único que el planeador necesita.
-- ============================================================================

create or replace function yz_ventas_bloques(p_account uuid, p_desde date, p_hasta date, p_b1 date, p_b2 date)
returns table (sku text, u_total bigint, u1 bigint, u2 bigint, u3 bigint, d1 int, d2 int, d3 int)
language sql stable security definer set search_path = public as $$
  select v.sku,
    sum(v.unidades)::bigint,
    sum(v.unidades) filter (where v.fecha >= p_b1)::bigint,
    sum(v.unidades) filter (where v.fecha >= p_b2 and v.fecha < p_b1)::bigint,
    sum(v.unidades) filter (where v.fecha < p_b2)::bigint,
    count(*) filter (where v.fecha >= p_b1 and v.unidades > 0)::int,
    count(*) filter (where v.fecha >= p_b2 and v.fecha < p_b1 and v.unidades > 0)::int,
    count(*) filter (where v.fecha < p_b2 and v.unidades > 0)::int
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;

create or replace function yz_snapshots_bloques(p_account uuid, p_desde date, p_hasta date, p_b1 date, p_b2 date)
returns table (sku text, f1 int, f2 int, f3 int, s1 int, s2 int, s3 int)
language sql stable security definer set search_path = public as $$
  select s.sku,
    count(*) filter (where s.fecha >= p_b1)::int,
    count(*) filter (where s.fecha >= p_b2 and s.fecha < p_b1)::int,
    count(*) filter (where s.fecha < p_b2)::int,
    count(*) filter (where s.fecha >= p_b1 and s.disponible > 0)::int,
    count(*) filter (where s.fecha >= p_b2 and s.fecha < p_b1 and s.disponible > 0)::int,
    count(*) filter (where s.fecha < p_b2 and s.disponible > 0)::int
  from yz_stock_snapshots s
  where s.account_id = p_account and s.fecha >= p_desde and s.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by s.sku;
$$;

create or replace function yz_ventas_resumen(p_account uuid, p_desde date, p_hasta date)
returns table (sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, unidades_sin_neto bigint)
language sql stable security definer set search_path = public as $$
  select v.sku,
    sum(v.unidades)::bigint,
    sum(v.ordenes)::bigint,
    sum(v.importe),
    sum(v.comision),
    sum(coalesce(v.neto, v.importe - v.comision)),
    sum(v.unidades) filter (where v.neto is null)::bigint
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;

create or replace function yz_ventas_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (fecha date, unidades bigint, importe numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  select v.fecha, sum(v.unidades)::bigint, sum(v.importe), sum(coalesce(v.neto, v.importe - v.comision))
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.fecha order by v.fecha;
$$;

revoke all on function yz_ventas_bloques(uuid, date, date, date, date) from public, anon;
revoke all on function yz_snapshots_bloques(uuid, date, date, date, date) from public, anon;
revoke all on function yz_ventas_resumen(uuid, date, date) from public, anon;
revoke all on function yz_ventas_por_dia(uuid, date, date) from public, anon;
grant execute on function yz_ventas_bloques(uuid, date, date, date, date) to authenticated, service_role;
grant execute on function yz_snapshots_bloques(uuid, date, date, date, date) to authenticated, service_role;
grant execute on function yz_ventas_resumen(uuid, date, date) to authenticated, service_role;
grant execute on function yz_ventas_por_dia(uuid, date, date) to authenticated, service_role;
