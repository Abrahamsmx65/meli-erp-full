-- Inicio: lo vendido por SKU en un rango, de los cuatro canales en UNA
-- llamada (dueño, 19-oct-2026: «cuando cambio entre fechas solo cambia la
-- barra de arriba, no todo el contenido de abajo»). La pantalla agrupa por
-- modelo con `modeloUnificado` para «Modelos que más venden» del periodo.
-- Lee lo ya sumado por día (`ventas_dia_sku` de calzado y fundas,
-- `amazon_ventas_diarias`, `tiktok_ventas_diarias`) acotado por los DOS
-- lados del rango; contesta jsonb para no topar con los 1,000 renglones.
-- Cada cuenta se revisa UNA vez; una que no es tuya (o null) no aporta.

create or replace function public.inicio_ventas_skus(
  p_meli uuid,
  p_amazon uuid,
  p_yz uuid,
  p_desde date,
  p_hasta date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  admin boolean := coalesce(auth.role(), '') = 'service_role';
  ok_meli boolean := p_meli is not null and (admin or es_mi_cuenta(p_meli));
  ok_amz boolean := p_amazon is not null and (admin or es_mi_cuenta_amazon(p_amazon));
  ok_yz boolean := p_yz is not null and (admin or es_mi_cuenta_yz(p_yz));
  r jsonb;
begin
  with v as (
    select 'meli_calzado'::text as canal, d.sku, sum(d.unidades)::bigint as u, sum(d.importe) as i
    from ventas_dia_sku d
    where ok_meli and d.account_id = p_meli and d.canal = 'meli_calzado'
      and d.fecha >= p_desde and d.fecha <= p_hasta
    group by d.sku
    union all
    select 'meli_fundas', d.sku, sum(d.unidades)::bigint, sum(d.importe)
    from ventas_dia_sku d
    where ok_yz and d.account_id = p_yz and d.canal = 'meli_fundas'
      and d.fecha >= p_desde and d.fecha <= p_hasta
    group by d.sku
    union all
    select 'amazon', a.seller_sku, sum(a.unidades)::bigint, sum(a.importe)
    from amazon_ventas_diarias a
    where ok_amz and a.account_id = p_amazon
      and a.fecha >= p_desde and a.fecha <= p_hasta
    group by a.seller_sku
    union all
    select 'tiktok', t.sku, sum(t.unidades)::bigint, sum(t.importe)
    from tiktok_ventas_diarias t
    where ok_meli and t.account_id = p_meli
      and t.fecha >= p_desde and t.fecha <= p_hasta
    group by t.sku
  )
  select coalesce(jsonb_agg(jsonb_build_array(canal, sku, u, i) order by canal, sku), '[]'::jsonb)
  into r
  from v
  where u <> 0 or i <> 0;
  return r;
end;
$$;

revoke all on function public.inicio_ventas_skus(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.inicio_ventas_skus(uuid, uuid, uuid, date, date) to authenticated, service_role;
