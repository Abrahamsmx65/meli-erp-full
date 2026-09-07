-- Las sumas de Amazon revisan el permiso UNA vez, no renglón por renglón.
--
-- `amazon_economia_por_sku` medida sobre los mismos 30 días: 1.4 s corriendo
-- como admin (sin RLS) y 4.8 s como la app (con RLS). La diferencia es la
-- política de `amazon_economia`: es_mi_cuenta_amazon() no es LEAKPROOF, así
-- que Postgres la evalúa por cada uno de los ~160 mil renglones y además
-- pierde el índice cubierto de la migración 0049. Con la base ocupada eso
-- rebasa el corte de 8 s de Supabase y el panel de Publicidad enseñaba
-- "sin datos" teniendo $343 mil de publicidad cargados.
--
-- Con SECURITY DEFINER la suma corre sin la política encima, y el permiso se
-- revisa explícitamente en la primera línea: quien pida una cuenta que no es
-- suya recibe un error, no datos. Es la misma garantía, una sola vez.
create or replace function amazon_economia_por_sku(
  p_account uuid,
  p_desde date,
  p_hasta date
)
returns table (
  seller_sku   text,
  unidades     numeric,
  ventas       numeric,
  tarifas      numeric,
  publicidad   numeric,
  neto         numeric,
  ultima_fecha date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      e.seller_sku,
      sum(e.unidades)   as unidades,
      sum(e.ventas)     as ventas,
      sum(e.tarifas)    as tarifas,
      sum(e.publicidad) as publicidad,
      sum(e.neto)       as neto,
      max(e.fecha)      as ultima_fecha
    from amazon_economia e
    where e.account_id = p_account
      and e.fecha >= p_desde
      and e.fecha <= p_hasta
    group by e.seller_sku;
end;
$$;

grant execute on function amazon_economia_por_sku(uuid, date, date) to authenticated;

-- Lo mismo para la suma que alimenta Planificación China: nació con el mismo
-- patrón y le pega el mismo costo por renglón sobre ventas y snapshots.
create or replace function amazon_compras_por_sku(
  p_account uuid,
  p_desde date
)
returns table (
  seller_sku   text,
  unidades     numeric,
  dias_agotado integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    with v as (
      -- El cast es obligatorio: unidades es entero, sum() da bigint y
      -- RETURN QUERY no lo convierte solo como sí lo hacía la función SQL.
      select av.seller_sku, sum(av.unidades)::numeric as unidades
      from amazon_ventas_diarias av
      where av.account_id = p_account
        and av.fecha >= p_desde
      group by av.seller_sku
    ),
    f as (
      select s.seller_sku, count(*)::integer as dias_agotado
      from amazon_inventario_snapshots s
      where s.account_id = p_account
        and s.fecha >= p_desde
        and coalesce(s.disponible, 0) <= 0
        and not exists (
          select 1
          from amazon_ventas_diarias av
          where av.account_id = p_account
            and av.seller_sku = s.seller_sku
            and av.fecha = s.fecha
            and av.unidades > 0
        )
      group by s.seller_sku
    )
    select v.seller_sku, v.unidades, coalesce(f.dias_agotado, 0)::integer as dias_agotado
    from v
    left join f on f.seller_sku = v.seller_sku;
end;
$$;

grant execute on function amazon_compras_por_sku(uuid, date) to authenticated;
