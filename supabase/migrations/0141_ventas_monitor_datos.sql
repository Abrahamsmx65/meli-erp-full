-- El monitor de Ventas MELI se calcula EN VIVO en cada visita (dueño,
-- 11-oct-2026: «antes todo era en vivo, todo funcionaba rápido»).
--
-- Desde la 0138 las ventas ya están sumadas por día y SKU en
-- `ventas_dia_sku` (al corriente en ≤ 1 min): los días cerrados SON el dato
-- guardado y sumar 60 días en Postgres tarda ~35 ms. Lo lento era el viaje:
-- `ventas_resumen_sku` por páginas de 1,000 (≈1,550 SKUs = 2 llamadas que
-- rehacían la suma) más `ventas_totales_dia` aparte. Esta función contesta
-- las DOS cosas en UNA llamada, con las mismas reglas al centavo:
--   skus: [sku, unidades, ordenes, importe, comision, neto_resuelto,
--          importe_neto_real, comision_neto_real, neto_real, unidades_hoy,
--          unidades_prev]   (= ventas_resumen_sku)
--   dias: [fecha, unidades, ordenes, importe]   (= ventas_totales_dia sobre
--          la misma ventana)
-- La ventana es la de `ventas_resumen_sku`: del inicio del periodo anterior
-- al mayor entre el fin del periodo y hoy.

create or replace function public.ventas_monitor_datos(
  p_account uuid,
  p_desde date,
  p_hasta date,
  p_prev_desde date,
  p_prev_hasta date,
  p_hoy date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account)) then
    raise exception 'Esa cuenta no es tuya';
  end if;

  with v as (
    select d.sku, d.fecha, d.unidades, d.ordenes, d.importe, d.comision, d.neto,
           coalesce(d.neto_confirmado, false) as nc
    from ventas_dia_sku d
    where d.account_id = p_account and d.canal = 'meli_calzado'
      and d.fecha >= least(p_prev_desde, p_desde)
      and d.fecha <= greatest(p_hasta, p_prev_hasta, p_hoy)
      and (d.unidades <> 0 or d.ordenes <> 0 or d.importe <> 0)
  ),
  s as (
    select v.sku,
      coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint as u,
      coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint as o,
      coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0) as i,
      coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0) as c,
      coalesce(sum(case when v.nc and v.neto is not null then v.neto
                        else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
               filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0) as nr,
      coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.nc), 0) as inr,
      coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.nc), 0) as cnr,
      coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.nc), 0) as ne,
      coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint as uh,
      coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint as up
    from v
    group by v.sku
  ),
  dd as (
    select v.fecha,
      coalesce(sum(v.unidades), 0)::bigint as u,
      coalesce(sum(v.ordenes), 0)::bigint as o,
      coalesce(sum(v.importe), 0) as i
    from v
    group by v.fecha
  )
  select jsonb_build_object(
    'skus', coalesce((select jsonb_agg(jsonb_build_array(sku, u, o, i, c, nr, inr, cnr, ne, uh, up) order by sku) from s), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(jsonb_build_array(fecha, u, o, i) order by fecha) from dd), '[]'::jsonb)
  ) into r;

  return r;
end;
$$;

revoke all on function public.ventas_monitor_datos(uuid, date, date, date, date, date) from public, anon;
grant execute on function public.ventas_monitor_datos(uuid, date, date, date, date, date) to authenticated, service_role;
