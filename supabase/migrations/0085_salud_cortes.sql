-- Los hechos de salud de cada mes, sumados EN POSTGRES.
--
-- Por qué: la revisión general tiene que mirar todos los meses de un vistazo,
-- y `consolidado_cache.datos` pesa megas por mes (trae el detalle por modelo
-- de cada canal). Bajarlo a Node para contar canales sería justo lo que la
-- regla de arquitectura prohíbe. Aquí sale un renglón chico por mes.
--
-- Lo que contesta, por mes:
--  · qué canales trae el corte (para cachar uno caído, como Amazon en julio)
--  · si el renglón está vigente y por qué no
--  · si la venta del total cuadra con la suma de sus canales
--  · cuántos avisos tiene y cuántos son por un timeout (una fuente caída)
create or replace function public.salud_cortes(p_account uuid)
returns table(
  periodo text,
  generado_en timestamptz,
  vigente boolean,
  motivo text,
  canales text[],
  venta_total numeric,
  venta_canales numeric,
  utilidad_total numeric,
  exacto boolean,
  avisos int,
  avisos_timeout int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.periodo,
    c.generado_en,
    coalesce(c.vigente, true),
    c.motivo,
    coalesce(
      (select array_agg(k->>'canal' order by k->>'canal')
         from jsonb_array_elements(c.datos->'canales') k),
      array[]::text[]),
    (c.datos->'total'->>'ventaBruta')::numeric,
    coalesce(
      (select sum((k->>'ventaBruta')::numeric)
         from jsonb_array_elements(c.datos->'canales') k), 0),
    (c.datos->'total'->>'utilidadNeta')::numeric,
    coalesce((c.datos->>'exacto')::boolean, false),
    coalesce((select count(*) from jsonb_array_elements_text(c.datos->'avisos')), 0)::int,
    coalesce((select count(*) from jsonb_array_elements_text(c.datos->'avisos') a
               where a ilike '%timeout%' or a ilike '%no se pudo cargar%'), 0)::int
  from consolidado_cache c
  where c.account_id = p_account
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  order by c.periodo desc;
$$;

grant execute on function public.salud_cortes(uuid) to authenticated, service_role;
