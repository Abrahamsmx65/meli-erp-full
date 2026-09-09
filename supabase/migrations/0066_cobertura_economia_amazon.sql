-- La economía solo es completa cuando cubre las ventas por importe, unidades
-- y cada día con venta. Estas funciones también dirigen la recarga al primer
-- hueco histórico, en lugar de volver a descargar meses ya cubiertos.
create or replace function amazon_economia_cobertura(
  p_account uuid, p_desde date, p_hasta date
)
returns table (
  cobertura_importe numeric,
  cobertura_unidades numeric,
  dias_venta integer,
  dias_cubiertos integer
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;
  return query
    with v as (
      select fecha, seller_sku, sum(importe) importe, sum(unidades)::numeric unidades
      from amazon_ventas_diarias
      where account_id = p_account and fecha between p_desde and p_hasta
        and (importe > 0 or unidades > 0)
      group by fecha, seller_sku
    ), e as (
      select fecha, seller_sku, sum(ventas) ventas, sum(unidades) unidades
      from amazon_economia
      where account_id = p_account and fecha between p_desde and p_hasta
      group by fecha, seller_sku
    ), por_sku_dia as (
      select
        v.fecha,
        least(greatest(coalesce(e.ventas, 0), 0), greatest(v.importe, 0)) importe_cubierto,
        greatest(v.importe, 0) importe_vendido,
        least(greatest(coalesce(e.unidades, 0), 0), greatest(v.unidades, 0)) unidades_cubiertas,
        greatest(v.unidades, 0) unidades_vendidas,
        coalesce(e.ventas, 0) >= v.importe
          and coalesce(e.unidades, 0) >= v.unidades as completo
      from v
      left join e using (fecha, seller_sku)
    ), por_dia as (
      select fecha, bool_and(completo) completo
      from por_sku_dia
      group by fecha
    )
    select
      coalesce(sum(importe_cubierto) / nullif(sum(importe_vendido), 0), 1),
      coalesce(sum(unidades_cubiertas) / nullif(sum(unidades_vendidas), 0), 1),
      (select count(*) from por_dia)::integer,
      (select count(*) from por_dia where completo)::integer
    from por_sku_dia;
end;
$$;

grant execute on function amazon_economia_cobertura(uuid, date, date) to authenticated;

create or replace function amazon_economia_hueco(p_account uuid, p_desde date, p_hasta date)
returns table (desde date, hasta date)
language sql stable security definer set search_path = public
as $$
  with v as (
    select fecha, seller_sku, sum(importe) importe, sum(unidades)::numeric unidades
    from amazon_ventas_diarias
    where account_id = p_account
      and fecha between coalesce(p_desde, '-infinity'::date) and p_hasta
      and (importe > 0 or unidades > 0)
    group by fecha, seller_sku
  ), e as (
    select fecha, seller_sku, sum(ventas) ventas, sum(unidades) unidades
    from amazon_economia
    where account_id = p_account and fecha <= p_hasta
    group by fecha, seller_sku
  ), faltantes as (
    select v.fecha
    from v left join e using (fecha, seller_sku)
    where coalesce(e.ventas, 0) < v.importe
       or coalesce(e.unidades, 0) < v.unidades
  )
  select min(fecha), max(fecha) from faltantes having count(*) > 0;
$$;

revoke all on function amazon_economia_hueco(uuid, date, date) from public;
grant execute on function amazon_economia_hueco(uuid, date, date) to service_role;

-- Cada documento de Data Kiosk es una foto completa del intervalo solicitado.
-- Reemplazarlo en una sola transacción elimina SKU/día que Amazon haya retirado
-- por cancelaciones o correcciones; un upsert solo los dejaría obsoletos.
create or replace function reemplazar_amazon_economia(
  p_account uuid,
  p_desde date,
  p_hasta date,
  p_filas jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Intervalo inválido para reemplazar economía de Amazon';
  end if;

  delete from amazon_economia
  where account_id = p_account and fecha between p_desde and p_hasta;

  insert into amazon_economia (
    account_id, seller_sku, fecha, unidades, ventas, tarifas, publicidad, neto, actualizado_en
  )
  select
    p_account,
    f.seller_sku,
    f.fecha,
    sum(f.unidades),
    sum(f.ventas),
    sum(f.tarifas),
    sum(f.publicidad),
    sum(f.neto),
    now()
  from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) as f(
    account_id uuid,
    seller_sku text,
    fecha date,
    unidades numeric,
    ventas numeric,
    tarifas numeric,
    publicidad numeric,
    neto numeric,
    actualizado_en timestamptz
  )
  where f.seller_sku <> '' and f.fecha between p_desde and p_hasta
  group by f.seller_sku, f.fecha;
end;
$$;

revoke all on function reemplazar_amazon_economia(uuid, date, date, jsonb) from public;
grant execute on function reemplazar_amazon_economia(uuid, date, date, jsonb) to service_role;

-- Una recarga histórica de ventas puede descubrir pedidos viejos después de
-- que economía ya avanzó. La cola obliga a releer exactamente esas ventanas.
create table amazon_economia_recargas (
  account_id uuid not null references amazon_accounts(id) on delete cascade,
  desde date not null,
  hasta date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'listo')),
  actualizado_en timestamptz not null default now(),
  primary key (account_id, desde, hasta)
);

alter table amazon_economia_recargas enable row level security;
revoke all on amazon_economia_recargas from public, anon, authenticated;
grant select, insert, update on amazon_economia_recargas to service_role;