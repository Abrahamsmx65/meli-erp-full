-- ============================================================================
--  La cascada de dinero por orden, con lo que Mercado Pago cobra de verdad.
--
--  Hasta aquí el desglose se leía de `/collections/{id}` (la forma vieja del
--  pago, solo escalares): retenciones en cero y dos tercios del dinero en
--  `cargos_sin_desglosar`. Ahora el pago se lee de
--  `https://api.mercadopago.com/v1/payments/{id}` (charges_details con
--  nombre, lado y reembolso por cargo), el envío del vendedor de
--  `/shipments/{id}/costs`, y la reventa se marca por `static_tags`
--  ("meli_resale") y se reconstruye al precio público con la tarifa de la
--  categoría (decisión del dueño: contemplar comisión y envío para comparar).
--
--  `neto` sigue siendo la cifra de control (lo depositado). Todo lo nuevo
--  EXPLICA; nada se vuelve a restar.
-- ============================================================================

alter table public.ordenes_neto
  add column if not exists pack_id bigint,
  add column if not exists shipping_id bigint,
  add column if not exists static_tags jsonb,
  add column if not exists pagado numeric,
  add column if not exists envio_comprador numeric,
  add column if not exists envio_vendedor numeric,
  add column if not exists libera_en timestamptz,
  add column if not exists cargos_fuente text,
  add column if not exists cargos_completos boolean,
  add column if not exists facturado numeric,
  add column if not exists neto_calculado numeric,
  add column if not exists total_comprador numeric,
  add column if not exists retencion_mp numeric,
  add column if not exists comision_reembolsada numeric,
  add column if not exists envio_reembolsado numeric,
  add column if not exists retencion_reembolsada numeric,
  add column if not exists pago_crudo jsonb,
  add column if not exists orden_cruda jsonb;

alter table public.yz_ordenes_neto
  add column if not exists pack_id bigint,
  add column if not exists shipping_id bigint,
  add column if not exists static_tags jsonb,
  add column if not exists pagado numeric,
  add column if not exists envio_comprador numeric,
  add column if not exists envio_vendedor numeric,
  add column if not exists libera_en timestamptz,
  add column if not exists cargos_fuente text,
  add column if not exists cargos_completos boolean,
  add column if not exists facturado numeric,
  add column if not exists neto_calculado numeric,
  add column if not exists total_comprador numeric,
  add column if not exists retencion_mp numeric,
  add column if not exists comision_reembolsada numeric,
  add column if not exists envio_reembolsado numeric,
  add column if not exists retencion_reembolsada numeric,
  add column if not exists pago_crudo jsonb,
  add column if not exists orden_cruda jsonb;

-- La recarga histórica recorre lo que nunca se leyó con el pago real
-- (cargos_fuente en null), de lo más reciente hacia atrás.
create index if not exists ordenes_neto_recarga_idx
  on public.ordenes_neto (account_id, fecha desc) where cargos_fuente is null;
create index if not exists yz_ordenes_neto_recarga_idx
  on public.yz_ordenes_neto (account_id, fecha desc) where cargos_fuente is null;

-- ---------------------------------------------------------------------------
-- Los RPC de órdenes por día aprenden: retención sin separar, el precio
-- público reconstruido de la reventa y cuántas órdenes tienen los cargos
-- completos. Postgres no permite cambiar las columnas de salida con
-- `create or replace`: se tiran y se vuelven a crear con las mismas firmas.
-- ---------------------------------------------------------------------------

drop function if exists cortes_ordenes_por_dia(uuid, date, date);
create function cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, dev_en_neto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric,
  dev_costo numeric, dev_unidades bigint, dev_sin_costo_unidades bigint, dev_sin_renglones_monto numeric,
  comision_mp numeric, envio_mp numeric, isr_mp numeric, iva_mp numeric, otros_mp numeric,
  cargos_sin_desglosar numeric, ajuste_liquidacion numeric, cargos_leidos bigint, netos_leidos bigint,
  reembolsos_base_pendientes bigint,
  retencion_mp numeric, reventa_total_comprador numeric, reventa_reconstruidas bigint, cargos_completos bigint,
  cargos_reales bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.order_id, o.fecha, o.estado, o.estado_pago, o.total, o.revisiones, o.renglones,
      o.neto as neto_original,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      greatest(0, coalesce(o.reembolsado, 0)) as reembolso,
      least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0))) as reembolso_base,
      coalesce(
        o.reembolso_base_confiable,
        coalesce(o.reembolsado, 0) = 0
      ) as base_confiable,
      coalesce(o.comision_mp, 0) as comision_mp,
      coalesce(o.envio_mp, 0) as envio_mp,
      coalesce(o.isr_mp, 0) as isr_mp,
      coalesce(o.iva_mp, 0) as iva_mp,
      coalesce(o.otros_mp, 0) as otros_mp,
      coalesce(o.retencion_mp, 0) as retencion_mp,
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar,
      o.cargos_leidos_en, o.neto_en, o.cargos_completos, o.cargos_fuente, o.total_comprador,
      coalesce(o.tipo_venta, case when o.total > 0 and o.neto >= o.total * 0.99 then 'reventa' else 'directa' end) as tipo_venta
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  ),
  o as (
    select b.*,
      case when b.base_confiable
        then greatest(0, b.reembolso - least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)))
        else 0 end as devolucion,
      least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)) as devolucion_en_neto,
      (b.neto_original - b.neto_hoy)
        - greatest(
            0,
            least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)) - b.reembolso_base
          ) as ajuste_liquidacion
    from base b
  ),
  dev as (
    select * from o where o.estado is distinct from 'cancelled' and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back'))
  ),
  dev_exacta as (
    select * from dev
    where renglones is not null and reembolso >= greatest(0, total - 0.01)
  ),
  devr as (
    select d.fecha,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      pc.costo_mxn
    from dev_exacta d
    cross join lateral jsonb_array_elements(d.renglones) as x
    left join skus s on s.account_id = p_account and s.sku = (x->>'sku')
    left join productos_config pc on pc.account_id = p_account and pc.color = ''
      and pc.modelo = coalesce(s.modelo, split_part(x->>'sku', '-', 1))
    where d.renglones is not null
  ),
  devc as (
    select fecha,
      coalesce(sum(unidades * costo_mxn) filter (where costo_mxn is not null), 0) as costo,
      coalesce(sum(unidades), 0)::bigint as unidades,
      coalesce(sum(unidades) filter (where costo_mxn is null), 0)::bigint as sin_costo
    from devr group by fecha
  )
  select o.fecha,
    count(*) filter (where o.estado is distinct from 'cancelled')::bigint,
    coalesce(sum(o.neto_hoy) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado = 'cancelled')::bigint,
    coalesce(sum(o.total) filter (where o.estado = 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back')))::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.devolucion_en_neto) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*)::bigint,
    count(*) filter (where o.revisiones >= 1)::bigint,
    count(*) filter (where o.revisiones < 2)::bigint,
    0::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa')::bigint,
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa'), 0),
    coalesce(max(devc.costo), 0),
    coalesce(max(devc.unidades), 0)::bigint,
    coalesce(max(devc.sin_costo), 0)::bigint,
    coalesce(sum(o.reembolso) filter (
      where o.estado is distinct from 'cancelled'
        and (o.renglones is null or o.reembolso < greatest(0, o.total - 0.01))
        and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back'))
    ), 0),
    coalesce(sum(o.comision_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.envio_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.isr_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.iva_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.otros_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.cargos_sin_desglosar) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.ajuste_liquidacion) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_leidos_en is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.neto_en is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.reembolso > 0 and not o.base_confiable)::bigint,
    coalesce(sum(o.retencion_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(coalesce(o.total_comprador, o.total)) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa' and o.total_comprador is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_leidos_en is not null and coalesce(o.cargos_completos, true))::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_fuente = 'v1/payments')::bigint
  from o left join devc on devc.fecha = o.fecha
  group by o.fecha order by o.fecha;
$$;

drop function if exists yz_cortes_ordenes_por_dia(uuid, date, date);
create function yz_cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, dev_en_neto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric,
  dev_costo numeric, dev_unidades bigint, dev_sin_costo_unidades bigint, dev_sin_renglones_monto numeric,
  comision_mp numeric, envio_mp numeric, isr_mp numeric, iva_mp numeric, otros_mp numeric,
  cargos_sin_desglosar numeric, ajuste_liquidacion numeric, cargos_leidos bigint, netos_leidos bigint,
  reembolsos_base_pendientes bigint,
  retencion_mp numeric, reventa_total_comprador numeric, reventa_reconstruidas bigint, cargos_completos bigint,
  cargos_reales bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.order_id, o.fecha, o.estado, o.estado_pago, o.total, o.revisiones, o.renglones,
      o.neto as neto_original,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      greatest(0, coalesce(o.reembolsado, 0)) as reembolso,
      least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0))) as reembolso_base,
      coalesce(
        o.reembolso_base_confiable,
        coalesce(o.reembolsado, 0) = 0
      ) as base_confiable,
      coalesce(o.comision_mp, 0) as comision_mp,
      coalesce(o.envio_mp, 0) as envio_mp,
      coalesce(o.isr_mp, 0) as isr_mp,
      coalesce(o.iva_mp, 0) as iva_mp,
      coalesce(o.otros_mp, 0) as otros_mp,
      coalesce(o.retencion_mp, 0) as retencion_mp,
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar,
      o.cargos_leidos_en, o.neto_en, o.cargos_completos, o.cargos_fuente, o.total_comprador,
      coalesce(o.tipo_venta, case when o.total > 0 and o.neto > 0 and o.neto >= o.total * 0.99 then 'reventa' else 'directa' end) as tipo_venta
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  o as (
    select b.*,
      case when b.base_confiable
        then greatest(0, b.reembolso - least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)))
        else 0 end as devolucion,
      least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)) as devolucion_en_neto,
      (b.neto_original - b.neto_hoy)
        - greatest(
            0,
            least(b.reembolso, b.reembolso_base + greatest(0, b.neto_original - b.neto_hoy)) - b.reembolso_base
          ) as ajuste_liquidacion
    from base b
  ),
  dev as (
    select * from o where o.estado is distinct from 'cancelled' and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back'))
  ),
  dev_exacta as (
    select * from dev
    where renglones is not null and reembolso >= greatest(0, total - 0.01)
  ),
  calzado as (select id from meli_accounts order by creado_en asc limit 1),
  devr as (
    select d.fecha,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce(pc.costo_mxn, yc.costo) as costo_mxn
    from dev_exacta d
    cross join lateral jsonb_array_elements(d.renglones) as x
    left join yz_skus s on s.account_id = p_account and s.sku = (x->>'sku')
    left join productos_config pc on pc.account_id = (select id from calzado) and pc.color = ''
      and pc.modelo = upper(coalesce(s.diseno, split_part(x->>'sku', '-', 1)))
    left join yz_costos yc on yc.account_id = p_account and yc.modelo = upper(coalesce(s.diseno, split_part(x->>'sku', '-', 1)))
    where d.renglones is not null
  ),
  devc as (
    select fecha,
      coalesce(sum(unidades * costo_mxn) filter (where costo_mxn is not null), 0) as costo,
      coalesce(sum(unidades), 0)::bigint as unidades,
      coalesce(sum(unidades) filter (where costo_mxn is null), 0)::bigint as sin_costo
    from devr group by fecha
  )
  select o.fecha,
    count(*) filter (where o.estado is distinct from 'cancelled')::bigint,
    coalesce(sum(o.neto_hoy) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado = 'cancelled')::bigint,
    coalesce(sum(o.total) filter (where o.estado = 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back')))::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.devolucion_en_neto) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*)::bigint,
    count(*) filter (where o.revisiones >= 1)::bigint,
    count(*) filter (where o.revisiones < 2)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.renglones is null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa')::bigint,
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa'), 0),
    coalesce(max(devc.costo), 0),
    coalesce(max(devc.unidades), 0)::bigint,
    coalesce(max(devc.sin_costo), 0)::bigint,
    coalesce(sum(o.reembolso) filter (
      where o.estado is distinct from 'cancelled'
        and (o.renglones is null or o.reembolso < greatest(0, o.total - 0.01))
        and (o.reembolso > 0 or o.estado_pago in ('refunded', 'charged_back'))
    ), 0),
    coalesce(sum(o.comision_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.envio_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.isr_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.iva_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.otros_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.cargos_sin_desglosar) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(o.ajuste_liquidacion) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_leidos_en is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.neto_en is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.reembolso > 0 and not o.base_confiable)::bigint,
    coalesce(sum(o.retencion_mp) filter (where o.estado is distinct from 'cancelled'), 0),
    coalesce(sum(coalesce(o.total_comprador, o.total)) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and o.tipo_venta = 'reventa' and o.total_comprador is not null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_leidos_en is not null and coalesce(o.cargos_completos, true))::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.cargos_fuente = 'v1/payments')::bigint
  from o left join devc on devc.fecha = o.fecha
  group by o.fecha order by o.fecha;
$$;

revoke all on function cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ordenes_por_dia(uuid, date, date) from public, anon;
grant execute on function cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
