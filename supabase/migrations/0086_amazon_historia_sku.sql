-- Historia de cada SKU en Amazon, SUMADA EN POSTGRES, para las reglas de
-- producto NUEVO y producto SIN VENTA del plan de FBA (las mismas tres reglas
-- de producto que el plan de Full, decididas por el dueño en sep-2026).
--
-- El plan de FBA solo veía la ventana del periodo (30 días): un producto que
-- NUNCA ha vendido un par en Amazon tenía faltante 0 y nunca salía en el
-- envío, aunque hubiera cajas en bodega y una publicación esperándolo. Con
-- esto el motor sabe qué SKUs vendieron alguna vez y cuándo se estrenaron
-- (primera venta o primera foto con stock), un renglón por SKU: nunca se
-- baja `amazon_ventas_diarias` cruda (154 mil renglones) a Node.
create or replace function public.amazon_historia_sku(p_account uuid)
returns table(seller_sku text, unidades bigint, primera_venta date, primera_foto date)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    with ventas as (
      select v.seller_sku,
             sum(v.unidades)::bigint                                   as unidades,
             min(v.fecha) filter (where v.unidades > 0)               as primera_venta
        from amazon_ventas_diarias v
       where v.account_id = p_account
       group by v.seller_sku
    ),
    fotos as (
      select s.seller_sku,
             min(s.fecha) filter (where s.total > 0)                  as primera_foto
        from amazon_inventario_snapshots s
       where s.account_id = p_account
       group by s.seller_sku
    )
    select coalesce(v.seller_sku, f.seller_sku) as seller_sku,
           coalesce(v.unidades, 0)::bigint      as unidades,
           v.primera_venta,
           f.primera_foto
      from ventas v
      full outer join fotos f on f.seller_sku = v.seller_sku
     order by 1;
end;
$$;

grant execute on function public.amazon_historia_sku(uuid) to authenticated, service_role;
