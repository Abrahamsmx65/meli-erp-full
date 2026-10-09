-- ============================================================================
--  Avance de los cortes de TikTok, agrupado en la base (9-oct-2026).
--
--  Despacho TikTok y la estación de preparar enseñan, por cada corte de la
--  lista (~30), cuántos paquetes tienen constancia de preparado, cuántos
--  pedidos se cancelaron después del corte y cuántos ya salieron (TikTok
--  los tiene en camino o entregados) sin escanearse. Hasta hoy la pantalla
--  bajaba las ~16 mil preparaciones y los ~16 mil pedidos cortados de TODA
--  la historia (~36 páginas de 1,000) para contar eso. Este RPC contesta
--  tres números por corte con las MISMAS reglas que la pantalla:
--
--    preparados = renglones de tiktok_preparaciones del corte
--    cancelados = pedidos del corte con estado CANCELLED / CANCEL
--    enviados   = pedidos del corte IN_TRANSIT / DELIVERED / COMPLETED que
--                 NO tienen constancia de preparado (corte + pedido): ya
--                 salieron sin escanearse; no se cuentan dos veces.
--
--  security definer con su propio control de acceso: el dueño, el miembro
--  de TikTok (rol tiktok) o el service_role.
-- ============================================================================

create or replace function public.tiktok_avance_cortes(p_account uuid, p_cortes bigint[])
returns table (corte_id bigint, preparados integer, cancelados integer, enviados integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user <> 'postgres'
     and not (es_mi_cuenta(p_account) or es_miembro_tiktok(p_account)) then
    raise exception 'tiktok_avance_cortes: la cuenta % no es tuya', p_account
      using errcode = '42501';
  end if;

  return query
  with prep as (
    select p.corte_id, count(*)::integer as n
    from tiktok_preparaciones p
    where p.account_id = p_account and p.corte_id = any (p_cortes)
    group by p.corte_id
  ),
  ords as (
    select
      o.corte_id,
      count(*) filter (where o.estado in ('CANCELLED', 'CANCEL'))::integer as cancelados,
      count(*) filter (
        where o.estado in ('IN_TRANSIT', 'DELIVERED', 'COMPLETED')
          and not exists (
            select 1 from tiktok_preparaciones p
            where p.account_id = p_account
              and p.corte_id = o.corte_id
              and p.order_id = o.order_id
          )
      )::integer as enviados
    from tiktok_ordenes o
    where o.account_id = p_account
      and o.corte_id = any (p_cortes)
      and o.estado in ('CANCELLED', 'CANCEL', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED')
    group by o.corte_id
  )
  select
    c.id as corte_id,
    coalesce(prep.n, 0) as preparados,
    coalesce(ords.cancelados, 0) as cancelados,
    coalesce(ords.enviados, 0) as enviados
  from unnest(p_cortes) as c(id)
  left join prep on prep.corte_id = c.id
  left join ords on ords.corte_id = c.id
  order by c.id;
end;
$$;

revoke execute on function public.tiktok_avance_cortes(uuid, bigint[]) from anon, public;
grant execute on function public.tiktok_avance_cortes(uuid, bigint[]) to authenticated, service_role;
