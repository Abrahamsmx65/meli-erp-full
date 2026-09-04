-- ============================================================================
--  amazon_compras_por_sku: la venta y los días agotado de Amazon, sumados
--  en la base, para la Planificación China.
--
--  amazonParaCompras (fba.ts) bajaba 30 días de ventas diarias (~40 mil
--  renglones) y 30 días de fotos del inventario (~80 mil) de mil en mil
--  para sumar unidades por SKU y contar los días en cero sin venta: más
--  de cien viajes al API por clic en /pedidos, cada uno de 1 a 7 s cuando
--  la base anda cargada, y la página moría a los 60 s de Vercel.
--
--  Esta función hace la misma cuenta en Postgres y devuelve ~5 mil
--  renglones en un viaje. Misma regla que el código: un día con la foto
--  en cero pero CON venta no cuenta como agotado (se agotó a media
--  jornada). Solo salen los SKUs con renglón de venta en la ventana, como
--  hacía el mapa `ventaSku`.
-- ============================================================================

create or replace function public.amazon_compras_por_sku(
  p_account uuid,
  p_desde date
)
returns table (
  seller_sku text,
  unidades numeric,
  dias_agotado integer
)
language sql
stable
set search_path = public
as $$
  with v as (
    select av.seller_sku, sum(av.unidades) as unidades
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
  select v.seller_sku, v.unidades, coalesce(f.dias_agotado, 0) as dias_agotado
  from v
  left join f on f.seller_sku = v.seller_sku;
$$;

grant execute on function public.amazon_compras_por_sku(uuid, date) to authenticated;
grant execute on function public.amazon_compras_por_sku(uuid, date) to service_role;
