-- Plan de Full LIGERO para la pantalla de Envíos a Full (9-oct-2026).
--
-- /envios bajaba en cada visita el plan guardado COMPLETO (~1.9 MB de
-- `plan_cache.datos`), aunque la pantalla no usa la `explicacion` de cada
-- línea (~0.5 MB de texto; solo la usa el Excel). Esta función devuelve el
-- mismo JSON sin ese campo, armado en Postgres.
--
-- SECURITY INVOKER: corre con la RLS de `plan_cache` (es_mi_cuenta), igual
-- que el select directo. Si no existe, `obtenerPlanLigero` baja el plan
-- completo como antes.
create or replace function public.plan_cache_ligero(p_account_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select (pc.datos - 'lineas')
    || jsonb_build_object(
      'lineas',
      coalesce(
        (
          select jsonb_agg(t.l - 'explicacion' order by t.o)
          from jsonb_array_elements(pc.datos -> 'lineas') with ordinality as t(l, o)
        ),
        '[]'::jsonb
      )
    )
  from public.plan_cache pc
  where pc.account_id = p_account_id;
$$;

revoke all on function public.plan_cache_ligero(uuid) from public, anon;
grant execute on function public.plan_cache_ligero(uuid) to authenticated, service_role;
