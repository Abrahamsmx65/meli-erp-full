-- El kardex de TikTok se SUMA en la base, no en Node (15-nov-2026). Supabase
-- avisó 570 GB de salida contra 275 GB del plan: `recalcularSaldos` bajaba
-- los ~100 mil movimientos y los ~59 mil renglones de pedido COMPLETOS en
-- cada aviso de TikTok y en cada corrida (≈ 900 mil páginas de 1,000
-- renglones al día). Estas funciones devuelven solo el resultado por SKU.

-- Saldo por SKU con la MISMA regla que `saldosDesdeMovimientos`: en orden de
-- fecha (sin fecha primero, empate por id), un `ajuste` PISA el saldo y lo
-- demás suma o resta. Equivale a: el último ajuste + todo lo que viene
-- después; sin ajuste, la suma de todo.
create or replace function public.tiktok_saldos_kardex(p_account uuid, p_skus text[] default null)
returns table(sku text, saldo bigint)
language sql
stable security definer
set search_path to 'public'
as $f$
  with m as (
    select t.sku, t.tipo, t.cantidad,
           row_number() over (partition by t.sku order by t.fecha asc nulls first, t.id asc) as rn
    from tiktok_movimientos t
    where t.account_id = p_account
      and (p_skus is null or t.sku = any(p_skus))
      and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  ), ultimo as (
    select m.sku, max(m.rn) as rn from m where m.tipo = 'ajuste' group by m.sku
  )
  select m.sku,
         sum(case
               when m.tipo in ('ajuste', 'entrada', 'devolucion') then m.cantidad
               when m.tipo in ('salida', 'merma') then -m.cantidad
               else 0
             end)::bigint
  from m left join ultimo u on u.sku = m.sku
  where m.rn >= coalesce(u.rn, 0)
  group by m.sku
  order by m.sku;
$f$;
revoke all on function public.tiktok_saldos_kardex(uuid, text[]) from public, anon;
grant execute on function public.tiktok_saldos_kardex(uuid, text[]) to authenticated, service_role;

-- Pares comprometidos por SKU (`estaComprometido`: pagado sin salir o sin
-- pagar todavía).
create or replace function public.tiktok_apartados_por_sku(p_account uuid, p_skus text[] default null)
returns table(sku text, apartado bigint)
language sql
stable security definer
set search_path to 'public'
as $f$
  select i.sku_interno, sum(i.cantidad)::bigint
  from tiktok_orden_items i
  where i.account_id = p_account
    and i.sku_interno is not null
    and (p_skus is null or i.sku_interno = any(p_skus))
    and upper(trim(coalesce(i.estado, ''))) in ('AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'ON_HOLD', 'UNPAID')
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  group by i.sku_interno
  order by i.sku_interno;
$f$;
revoke all on function public.tiktok_apartados_por_sku(uuid, text[]) from public, anon;
grant execute on function public.tiktok_apartados_por_sku(uuid, text[]) to authenticated, service_role;

-- Los SKUs que alguien ya contó (alguna entrada o ajuste).
create or replace function public.tiktok_skus_contados(p_account uuid)
returns table(sku text)
language sql
stable security definer
set search_path to 'public'
as $f$
  select distinct t.sku
  from tiktok_movimientos t
  where t.account_id = p_account
    and t.tipo in ('entrada', 'ajuste')
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  order by t.sku;
$f$;
revoke all on function public.tiktok_skus_contados(uuid) from public, anon;
grant execute on function public.tiktok_skus_contados(uuid) to authenticated, service_role;
