-- ============================================================================
--  Cuánto tardó la preparación de cada corte de TikTok (9-oct-2026).
--
--  Dueño: «quiero que me aumentes ahí al lado el tiempo que tomó preparar
--  cada despacho». Por corte, la primera y la última constancia de preparado
--  (`tiktok_preparaciones.preparado_en`); Despacho enseña la diferencia como
--  el tiempo de preparación (y «en curso» mientras falten paquetes). Va en
--  su propio RPC para no tocar `tiktok_avance_cortes` (0120).
--
--  security definer con su propio control de acceso: el dueño, el miembro
--  de TikTok (rol tiktok), el service_role o postgres.
-- ============================================================================

create or replace function public.tiktok_tiempos_cortes(p_account uuid, p_cortes bigint[])
returns table (corte_id bigint, primera_prep timestamptz, ultima_prep timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.corte_id, min(p.preparado_en), max(p.preparado_en)
  from tiktok_preparaciones p
  where p.account_id = p_account and p.corte_id = any (p_cortes)
    and (coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres'
         or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  group by p.corte_id
$$;

revoke execute on function public.tiktok_tiempos_cortes(uuid, bigint[]) from anon, public;
grant execute on function public.tiktok_tiempos_cortes(uuid, bigint[]) to authenticated, service_role;
