-- 0165: cerrar las tablas y vistas de trabajo (yz_tmp_*, tmp_*) que se
-- crearon a mano por SQL y quedaron abiertas a la llave pública.
-- Alerta de Supabase del 22-nov-2026 «Table publicly accessible»
-- (rls_disabled_in_public, security_definer_view). Ningún código las usa.
-- No se borra nada: RLS prendido SIN políticas (solo service_role, como
-- meli_tokens), sin permisos para anon/authenticated y las vistas con los
-- permisos de quien consulta.

alter table public.yz_tmp_activas       enable row level security;
alter table public.yz_tmp_bf_salida     enable row level security;
alter table public.yz_tmp_campanas      enable row level security;
alter table public.yz_tmp_nav_cand_vivo enable row level security;
alter table public.yz_tmp_nav_extra     enable row level security;
alter table public.yz_tmp_nav_falta     enable row level security;
alter table public.yz_tmp_nav_manual    enable row level security;
alter table public.yz_tmp_nav_no        enable row level security;
alter table public.yz_tmp_nav_pend      enable row level security;
alter table public.yz_tmp_navidad_res   enable row level security;

alter view public.yz_tmp_navidad_calzado set (security_invoker = true);
alter view public.yz_tmp_navidad_plan    set (security_invoker = true);

revoke all on
  public.yz_tmp_activas, public.yz_tmp_bf_salida, public.yz_tmp_campanas,
  public.yz_tmp_nav_cand_vivo, public.yz_tmp_nav_extra, public.yz_tmp_nav_falta,
  public.yz_tmp_nav_manual, public.yz_tmp_nav_no, public.yz_tmp_nav_pend,
  public.yz_tmp_navidad_res, public.yz_tmp_navidad_calzado, public.yz_tmp_navidad_plan,
  public.tmp_aporte_vivo, public.tmp_cancel_smart, public.tmp_cancel_smart_yz,
  public.tmp_promos_vivo, public.tmp_reinscribe, public.tmp_reinscribe2,
  public.tmp_scan_items, public.tmp_tienda_oficial
from anon, authenticated;

alter function public.yz_salida_bf_navidad(integer) set search_path = public, pg_temp;
revoke execute on function public.yz_salida_bf_navidad(integer) from public, anon, authenticated;
