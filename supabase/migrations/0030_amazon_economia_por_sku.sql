-- La economía por producto de Amazon, ya sumada por SKU.
--
-- `amazon_economia` guarda un renglón por SKU y por DÍA: un rango de 30 días
-- son ~154 mil renglones, que en páginas de mil son 154 viajes a la base —
-- más de lo que una pantalla aguanta, y el panel de Publicidad Amazon
-- terminaba enseñando "sin datos" cuando sí los había. La suma se hace aquí:
-- ~6 mil renglones (uno por SKU) en un solo viaje.
--
-- SECURITY INVOKER a propósito: la función corre con los permisos de quien
-- llama, así que el RLS de `amazon_economia` (es_mi_cuenta_amazon) sigue
-- mandando y nadie ve la economía de otra cuenta.
create or replace function amazon_economia_por_sku(
  p_account uuid,
  p_desde date,
  p_hasta date
)
returns table (
  seller_sku   text,
  unidades     numeric,
  ventas       numeric,
  tarifas      numeric,
  publicidad   numeric,
  neto         numeric,
  ultima_fecha date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.seller_sku,
    sum(e.unidades)   as unidades,
    sum(e.ventas)     as ventas,
    sum(e.tarifas)    as tarifas,
    sum(e.publicidad) as publicidad,
    sum(e.neto)       as neto,
    max(e.fecha)      as ultima_fecha
  from amazon_economia e
  where e.account_id = p_account
    and e.fecha >= p_desde
    and e.fecha <= p_hasta
  group by e.seller_sku;
$$;

grant execute on function amazon_economia_por_sku(uuid, date, date) to authenticated;
