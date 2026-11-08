-- Lo que MELI COBRÓ DE VERDAD de envío por modelo y TRAMO DE PRECIO
-- (dueño, 8-nov-2026: «no cuadra lo que dices que recibo contra lo que
-- recibo de verdad»). Números usaba el simulador de MELI, que contesta el
-- costo de LISTA ($139.50 en GT190) y no lo que se descuenta (en GT190,
-- $88.50 en la orden 2000019378989864, reventa a $539.79 → recibe $370.32).
-- Aquí: órdenes de UN renglón y UN par (un carrito carga el paquete
-- completo a cada orden; tampoco las de un pack), con reventa incluida (ahí también viene
-- `envio_vendedor`), al precio que pagó el cliente (`total_comprador` en
-- reventa), partidas por tramo: 0 = abajo de $299, 1 = $299 a $498.99,
-- 2 = desde $499. Mediana del envío y de lo que se quedó MELI en %.
create or replace function public.meli_envio_por_modelo_tramo(p_account uuid, p_desde date)
returns table (
  modelo text,
  tramo int,
  pares bigint,
  envio_par numeric,
  precio_par numeric
)
language sql stable security definer set search_path = public
as $$
  with x as (
    select upper(split_part(r->>'sku', '-', 1)) as modelo,
           coalesce(o.total_comprador, o.total) as precio,
           o.envio_vendedor
    from ordenes_neto o
    cross join lateral jsonb_array_elements(o.renglones) r
    where o.account_id = p_account
      and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account))
      and o.fecha >= p_desde
      and o.estado is distinct from 'cancelled'
      and o.envio_vendedor is not null
      and o.pack_id is null
      and o.total > 0
      and o.renglones is not null and jsonb_array_length(o.renglones) = 1
      and coalesce((r->>'unidades')::int, 1) = 1
      and coalesce(r->>'sku', '') <> ''
  )
  select x.modelo,
         case when x.precio < 299 then 0 when x.precio < 499 then 1 else 2 end as tramo,
         count(*)::bigint,
         round((percentile_cont(0.5) within group (order by x.envio_vendedor))::numeric, 2),
         round(avg(x.precio), 2)
  from x
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.meli_envio_por_modelo_tramo(uuid, date) from public, anon;
grant execute on function public.meli_envio_por_modelo_tramo(uuid, date) to authenticated, service_role;
