-- `ventas_resumen_sku` sin ORDER BY: el API de Supabase entrega a lo más
-- 1,000 renglones por respuesta y el calzado ya tiene 1,667 SKUs con venta,
-- así que hay que leerlo por páginas (`traerRpcTodo`), y paginar sin un
-- orden estable duplica o pierde renglones entre páginas. Mismo cuerpo,
-- solo se agrega `order by v.sku`.
create or replace function public.ventas_resumen_sku(p_account uuid, p_desde date, p_hasta date, p_prev_desde date, p_prev_hasta date, p_hoy date)
 returns table(sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto_resuelto numeric, importe_neto_real numeric, comision_neto_real numeric, neto_real numeric, unidades_hoy bigint, unidades_prev bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select v.sku,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(case when v.neto_confirmado and v.neto is not null then v.neto
                      else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
             filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= least(p_prev_desde, p_desde)
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  group by v.sku
  order by v.sku;
$function$;
