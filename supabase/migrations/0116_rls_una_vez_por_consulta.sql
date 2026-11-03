-- RLS evaluada UNA vez por consulta, no una vez por renglón (9-oct-2026).
--
-- Las políticas decían `es_mi_cuenta(account_id)`. Esa función es SECURITY
-- DEFINER, así que Postgres no la puede «aplanar» y la corre con su consulta
-- a meli_accounts EN CADA RENGLÓN. Medido en producción: la lista de pedidos
-- cortados de TikTok (16,537 renglones) tardaba 432 ms con RLS y 24 ms sin
-- ella; en promedio una consulta de pantalla tardaba 226 ms contra 10 ms del
-- trabajo de fondo (service_role, sin RLS).
--
-- La regla es la MISMA, escrita de forma que Postgres la evalúe una sola vez:
--   es_mi_cuenta(x)        →  x in (select public.mis_cuentas_meli())
--   es_mi_cuenta_amazon(x) →  x in (select public.mis_cuentas_amazon())
--   es_mi_cuenta_yz(x)     →  x in (select public.mis_cuentas_yz())
--   es_miembro_tiktok(x)   →  x in (select public.mis_cuentas_tiktok())
--   auth.uid()             →  (select auth.uid())
-- `(select f())` sin columnas del renglón es un subplan sin correlación: se
-- calcula una vez y se compara con un hash.
--
-- Las funciones es_mi_cuenta* se quedan como estaban: las usan los RPC.

create or replace function public.mis_cuentas_meli()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from meli_accounts where owner_id = auth.uid();
$$;

create or replace function public.mis_cuentas_amazon()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from amazon_accounts where owner_id = auth.uid();
$$;

create or replace function public.mis_cuentas_yz()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from yz_cuentas where owner_id = auth.uid();
$$;

create or replace function public.mis_cuentas_tiktok()
returns setof uuid language sql stable security definer set search_path = public as $$
  select account_id from cuenta_miembros where user_id = auth.uid() and rol = 'tiktok';
$$;

-- Mismos permisos que es_mi_cuenta(): authenticated sí, anon no.
revoke all on function public.mis_cuentas_meli() from public, anon;
revoke all on function public.mis_cuentas_amazon() from public, anon;
revoke all on function public.mis_cuentas_yz() from public, anon;
revoke all on function public.mis_cuentas_tiktok() from public, anon;
grant execute on function public.mis_cuentas_meli() to authenticated, service_role;
grant execute on function public.mis_cuentas_amazon() to authenticated, service_role;
grant execute on function public.mis_cuentas_yz() to authenticated, service_role;
grant execute on function public.mis_cuentas_tiktok() to authenticated, service_role;

-- Reescritura mecánica de TODAS las políticas del esquema public.
create or replace function pg_temp.rls_una_vez(e text) returns text language sql immutable as $$
  select regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(e,
           'es_mi_cuenta_amazon\(([a-z_.]+)\)', '(\1 in (select public.mis_cuentas_amazon()))', 'g'),
           'es_mi_cuenta_yz\(([a-z_.]+)\)', '(\1 in (select public.mis_cuentas_yz()))', 'g'),
           'es_miembro_tiktok\(([a-z_.]+)\)', '(\1 in (select public.mis_cuentas_tiktok()))', 'g'),
           'es_mi_cuenta\(([a-z_.]+)\)', '(\1 in (select public.mis_cuentas_meli()))', 'g'),
           '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'g');
$$;

do $$
declare
  p record;
  nuevo_using text;
  nuevo_check text;
  sentencia text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(es_mi_cuenta|es_miembro_tiktok|auth\.uid\(\))'
        or coalesce(with_check, '') ~ '(es_mi_cuenta|es_miembro_tiktok|auth\.uid\(\))')
  loop
    nuevo_using := case when p.qual is null then null else pg_temp.rls_una_vez(p.qual) end;
    nuevo_check := case when p.with_check is null then null else pg_temp.rls_una_vez(p.with_check) end;
    sentencia := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if nuevo_using is not null then
      sentencia := sentencia || format(' using (%s)', nuevo_using);
    end if;
    if nuevo_check is not null then
      sentencia := sentencia || format(' with check (%s)', nuevo_check);
    end if;
    execute sentencia;
  end loop;
end $$;
