-- La venta del corte de CALZADO sale de las ÓRDENES, no de ventas_diarias
-- (9-oct-2026, revisión de septiembre 2026).
--
-- ventas_diarias se reescribe en cada barrido: unidades, órdenes e importe
-- se vuelven a escribir pero el neto NO (el upsert conserva el anterior con
-- neto_confirmado = true), y la búsqueda status=paid de MELI devuelve órdenes
-- que /orders/{id} tiene canceladas y reembolsadas. Septiembre quedó con 279
-- pares, 288 órdenes y $38 mil de venta de más contra las órdenes vivas, y
-- los días que «no cuadraban» tomaban el neto viejo de los renglones (el
-- doble en muchas tallas): +$67.6 mil de neto que no existía. Fundas ya se
-- arma desde sus órdenes (yz_cortes_ventas_desde_ordenes_confirmadas); este
-- es el mismo cálculo sobre ordenes_neto.
--
-- Devuelve UN jsonb (no un conjunto): PostgREST entrega a lo más mil
-- renglones por respuesta y un mes son ~25 mil (sku, día); paginar volvía a
-- correr la función completa en cada página.
create or replace function public.cortes_ventas_desde_ordenes(p_account uuid, p_desde date, p_hasta date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with o as (
    select o.order_id, o.fecha, o.total, o.renglones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido,
      (select sum(coalesce((y->>'importe')::numeric, 0))
         from jsonb_array_elements(o.renglones) y) as importe_orden
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
  ),
  r as (
    select o.fecha, o.total, o.neto_hoy, o.neto_conocido, o.importe_orden,
      x->>'sku' as sku,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce((x->>'importe')::numeric, 0) as importe,
      coalesce((x->>'comision')::numeric, 0) as comision
    from o, jsonb_array_elements(o.renglones) as x
  ),
  g as (
    select r.sku, r.fecha,
      sum(r.unidades)::bigint as unidades,
      count(*)::bigint as ordenes,
      sum(r.importe) as importe,
      sum(r.comision) as comision,
      case when bool_or(r.total > 0 and not r.neto_conocido) then 0
           else round(sum(case when r.neto_conocido and r.importe_orden > 0
                               then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end as neto,
      not bool_or(r.total > 0 and not r.neto_conocido) as neto_confirmado
    from r
    where r.sku is not null and r.sku <> ''
    group by r.sku, r.fecha
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'sku', g.sku, 'fecha', g.fecha, 'unidades', g.unidades, 'ordenes', g.ordenes,
      'importe', g.importe, 'comision', g.comision, 'neto', g.neto, 'neto_confirmado', g.neto_confirmado
    ) order by g.fecha, g.sku), '[]'::jsonb)
  from g;
$function$;

revoke all on function public.cortes_ventas_desde_ordenes(uuid, date, date) from public, anon;
grant execute on function public.cortes_ventas_desde_ordenes(uuid, date, date) to authenticated, service_role;
