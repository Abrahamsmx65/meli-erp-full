-- El control de acceso de los RPC de cortes y ventas se evalúa UNA vez por
-- consulta, no renglón por renglón (9-oct-2026).
--
-- Estas funciones SQL filtraban con
--   and (auth.role() = 'service_role' or es_mi_cuenta…(p_account))
-- dentro del WHERE. auth.role() lee y parsea request.jwt.claims en CADA
-- renglón: yz_cortes_ventas_desde_ordenes_confirmadas de abril (90 mil
-- órdenes) tardaba 5.6 s contra 0.07 s con la condición como subconsulta
-- escalar (InitPlan, una sola vez). Paginado de mil en mil por el tope de
-- PostgREST, el cron del corte general pasaba de los 8 s del rol y se
-- cancelaba («canceling statement due to statement timeout») en marzo a
-- julio de fundas, así que esos meses se quedaban con el renglón viejo.
--
-- La regla es la misma que las políticas de RLS de la 0116: la condición va
-- envuelta en (select …). La semántica no cambia: es la misma expresión,
-- sin columnas del renglón.
do $$
declare
  f record;
  def text;
  nuevo text;
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prolang = (select oid from pg_language where lanname = 'sql')
      and p.proname in (
        'cortes_desglose_por_sku', 'cortes_ordenes_por_dia', 'cortes_ratio_observado',
        'salud_cortes', 'salud_cortes_v2', 'ventas_resumen_sku', 'ventas_totales_dia',
        'yz_cortes_desglose_por_sku', 'yz_cortes_ordenes_por_dia', 'yz_cortes_ratio_observado',
        'yz_cortes_ventas_desde_ordenes', 'yz_cortes_ventas_desde_ordenes_confirmadas',
        'yz_netos_observados', 'yz_ultima_venta', 'yz_ultimas_ventas', 'yz_ventas_bloques',
        'yz_ventas_por_dia', 'yz_ventas_renglones', 'yz_ventas_renglones_confirmados',
        'yz_ventas_resumen'
      )
  loop
    def := pg_get_functiondef(f.oid);
    nuevo := regexp_replace(
      def,
      '\(auth\.role\(\) = ''service_role'' or (es_mi_cuenta(_yz)?)\(p_account\)\)',
      '(select auth.role() = ''service_role'' or \1(p_account))',
      'g'
    );
    if nuevo <> def then
      execute nuevo;
    end if;
  end loop;
end
$$;
