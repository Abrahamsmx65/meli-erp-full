-- 0160 · Seguridad de funciones (16-nov-2026, revisión pedida por el dueño).
--
-- 1) 16 funciones SECURITY DEFINER se podían llamar SIN sesión (rol `anon`,
--    con la llave pública que viaja al navegador). Catorce traen su propio
--    control adentro (es_mi_cuenta / service_role) y contestaban error, pero
--    dos NO lo traían: `reemplazar_amazon_economia` (ESCRIBE: reemplaza los
--    renglones de SKU Economics de un rango) y `amazon_economia_hueco`.
--    Cualquiera con la llave pública podía reescribir esos datos.
--    Ahora: nadie sin sesión ejecuta ninguna; las dos sin control quedan SOLO
--    para el fondo (service_role, que es quien las llama desde
--    `amazon/economia.ts`); las demás, sesión o fondo.
-- 2) 10 funciones sin `search_path` fijo: se les fija `public, extensions`.
--
-- Un solo bloque a propósito: el MCP de Supabase se cuelga con varias
-- sentencias DDL juntas.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    if f.proname in ('reemplazar_amazon_economia', 'amazon_economia_hueco') then
      execute format('revoke execute on function %s from authenticated', f.firma);
      execute format('grant execute on function %s to service_role', f.firma);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.firma);
    end if;
  end loop;

  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in (
        'amazon_resumen_skus', 'amazon_totales', 'tiktok_nunca_surte_full',
        'tienda_disponible_de', 'tienda_disponibles', 'tienda_recalcular_apartado',
        'tienda_crear_pedido', 'tienda_marcar_pago', 'tienda_expirar', 'ejercicio_actual'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, extensions', f.firma);
  end loop;
end
$$;
