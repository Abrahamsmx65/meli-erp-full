-- Los pedidos de Amazon con su NÚMERO, para saber cuánto paga Amazon por
-- cada uno (dueño, 19-nov-2026: «en el correo de las ventas del día, en
-- Amazon manda solo lo que se cobró; tiene que ser igual que MELI: que
-- mande lo que aún no se cobró y con el monto que Amazon dice que va a
-- pagar, no estimado»).
--
-- `amazon_ventas_diarias` suma por SKU y día y pierde el pedido, así que no
-- había cómo cruzar lo vendido AYER con lo que Amazon asentó por esos
-- mismos pedidos (los eventos de envío de la Finances API traen el
-- `amazon_order_id`). La lectura del reporte de órdenes guarda ahora un
-- renglón por pedido + SKU; los cancelados se guardan marcados (un pedido
-- que se cancela después deja de contar al releer la ventana).
--
-- `amazon_pedidos_pago` devuelve, por SKU, lo vendido en el rango (por
-- fecha de COMPRA, México) y de eso lo que Amazon YA dice cuánto paga
-- (renglones de ShipmentEventList del mismo pedido y SKU, asentados en
-- cualquier fecha). Lo que Amazon aún no envía no trae número de Amazon:
-- se cuenta aparte, nunca se estima.

create table if not exists public.amazon_pedidos_renglones (
  account_id uuid not null,
  amazon_order_id text not null,
  seller_sku text not null,
  fecha date not null,
  unidades integer not null default 0,
  importe numeric not null default 0,
  cancelado boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, amazon_order_id, seller_sku)
);
create index if not exists amazon_pedidos_renglones_fecha_idx
  on public.amazon_pedidos_renglones (account_id, fecha);

alter table public.amazon_pedidos_renglones enable row level security;
create policy amazon_pedidos_renglones_mias on public.amazon_pedidos_renglones
  for all using (account_id in (select mis_cuentas_amazon()));

create or replace function public.amazon_pedidos_pago(p_account uuid, p_desde date, p_hasta date)
 returns table(seller_sku text, unidades numeric, importe numeric, unidades_pagadas numeric, importe_pagado numeric, neto numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_amazon(p_account)) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    with p as (
      select r.amazon_order_id, r.seller_sku, r.unidades, r.importe
      from amazon_pedidos_renglones r
      where r.account_id = p_account and r.fecha >= p_desde and r.fecha <= p_hasta
        and not r.cancelado and r.unidades > 0
    ),
    ev as (
      select e.amazon_order_id, coalesce(x.value->>'sku', '') as sku,
        sum((x.value->>'unidades')::numeric) as u,
        sum((x.value->>'neto')::numeric) as neto
      from amazon_finanzas_eventos e
      cross join lateral jsonb_array_elements(coalesce(e.renglones, '[]'::jsonb)) x
      where e.account_id = p_account
        and e.lista = 'ShipmentEventList'
        and e.amazon_order_id in (select amazon_order_id from p)
      group by 1, 2
    ),
    j as (
      select p.seller_sku, p.unidades::numeric as u, p.importe,
        least(p.unidades::numeric, greatest(coalesce(ev.u, 0), 0)) as u_pag,
        ev.neto
      from p left join ev on ev.amazon_order_id = p.amazon_order_id and ev.sku = p.seller_sku
    )
    select j.seller_sku,
      sum(j.u),
      round(sum(j.importe), 2),
      sum(j.u_pag),
      round(sum(case when j.u > 0 then j.importe * j.u_pag / j.u else 0 end), 2),
      round(sum(coalesce(j.neto, 0)), 2)
    from j
    group by j.seller_sku
    order by j.seller_sku;
end;
$function$;

revoke execute on function public.amazon_pedidos_pago(uuid, date, date) from public, anon;
grant execute on function public.amazon_pedidos_pago(uuid, date, date) to authenticated, service_role;
