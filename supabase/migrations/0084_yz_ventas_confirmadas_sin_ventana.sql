-- La venta de fundas del corte, sin la función de ventana que se iba a disco.
--
-- Por qué: mayo tiene 85,330 órdenes (junio 54,319) y el corte general de mayo
-- se quedó SIN el canal de fundas con
-- «yz_cortes_ventas_desde_ordenes_confirmadas: canceling statement due to
-- statement timeout». La causa es el `sum(...) over (partition by order_id)`:
-- obliga a ordenar las 85 mil órdenes por order_id y el ordenamiento se sale
-- a disco (external merge, 9 MB). Encima la lectura pagina de mil en mil, y
-- CADA página vuelve a correr el mes completo.
--
-- El importe de la orden no necesita ventana: es la suma de SUS PROPIOS
-- renglones, así que sale con un subselect sobre el mismo jsonb. Medido con
-- mayo real: 2,150 ms → 765 ms y sin tocar disco.
--
-- Además se devuelve YA ORDENADO por (sku, fecha), que es como lo pide la
-- lectura paginada: así el ORDER BY de PostgREST no vuelve a ordenar todo.
create or replace function public.yz_cortes_ventas_desde_ordenes_confirmadas(
  p_account uuid,
  p_desde date,
  p_hasta date
)
returns table(
  sku text,
  fecha date,
  unidades bigint,
  ordenes bigint,
  importe numeric,
  comision numeric,
  neto numeric,
  neto_confirmado boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with o as (
    select o.order_id, o.fecha, o.total, o.renglones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido,
      (select sum(coalesce((y->>'importe')::numeric, 0))
         from jsonb_array_elements(o.renglones) y) as importe_orden
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  r as (
    select o.fecha, o.total, o.neto_hoy, o.neto_conocido, o.importe_orden,
      x->>'sku' as sku,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce((x->>'importe')::numeric, 0) as importe,
      coalesce((x->>'comision')::numeric, 0) as comision
    from o, jsonb_array_elements(o.renglones) as x
  )
  select r.sku, r.fecha,
    sum(r.unidades)::bigint,
    count(*)::bigint,
    sum(r.importe),
    sum(r.comision),
    case when bool_or(r.total > 0 and not r.neto_conocido) then 0
         else round(sum(case when r.neto_conocido and r.importe_orden > 0
                             then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end,
    not bool_or(r.total > 0 and not r.neto_conocido)
  from r
  where r.sku is not null
  group by r.sku, r.fecha
  order by r.sku, r.fecha;
$function$;

grant execute on function public.yz_cortes_ventas_desde_ordenes_confirmadas(uuid, date, date) to authenticated, service_role;
