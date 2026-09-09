-- ============================================================================
--  Desglose por orden de lo que Mercado Pago descuenta.
--
--  `neto` y `neto_actual` siguen siendo la cifra de control. Estas columnas
--  explican el depósito; no son gastos que deban restarse otra vez.
-- ============================================================================

alter table public.ordenes_neto
  add column if not exists neto_en timestamptz,
  add column if not exists comision_mp numeric,
  add column if not exists envio_mp numeric,
  add column if not exists isr_mp numeric,
  add column if not exists iva_mp numeric,
  add column if not exists otros_mp numeric,
  add column if not exists cargos_sin_desglosar numeric,
  add column if not exists detalle_cargos jsonb,
  add column if not exists tipo_venta text,
  add column if not exists reembolso_incluido_neto_base numeric,
  add column if not exists reembolso_base_confiable boolean,
  add column if not exists cargos_leidos_en timestamptz;

-- Antes de este marcador, una fila de calzado solo se creaba después de leer
-- Mercado Pago. Inicializar las existentes conserva esa evidencia histórica;
-- las nuevas escrituras lo actualizan explícitamente tras una lectura completa.
update public.ordenes_neto
set neto_en = actualizado_en
where neto_en is null;

alter table public.yz_ordenes_neto
  add column if not exists comision_mp numeric,
  add column if not exists envio_mp numeric,
  add column if not exists isr_mp numeric,
  add column if not exists iva_mp numeric,
  add column if not exists otros_mp numeric,
  add column if not exists cargos_sin_desglosar numeric,
  add column if not exists detalle_cargos jsonb,
  add column if not exists tipo_venta text,
  add column if not exists reembolso_incluido_neto_base numeric,
  add column if not exists reembolso_base_confiable boolean,
  add column if not exists cargos_leidos_en timestamptz;

-- Solo una orden que ya tenía una liquidación confirmada y ningún reembolso
-- permite certificar una base cero. Las filas YZ pendientes nunca deben recibir
-- procedencia: su primera lectura debe inferirla de la respuesta de Mercado Pago.
update public.ordenes_neto
set reembolso_incluido_neto_base = 0, reembolso_base_confiable = true
where neto_en is not null and coalesce(reembolsado, 0) = 0;

update public.yz_ordenes_neto
set reembolso_incluido_neto_base = 0, reembolso_base_confiable = true
where neto_en is not null and coalesce(reembolsado, 0) = 0;

alter table public.ordenes_neto
  drop constraint if exists ordenes_neto_tipo_venta_check;
alter table public.ordenes_neto
  add constraint ordenes_neto_tipo_venta_check
  check (tipo_venta is null or tipo_venta in ('directa', 'reventa'));

alter table public.yz_ordenes_neto
  drop constraint if exists yz_ordenes_neto_tipo_venta_check;
alter table public.yz_ordenes_neto
  add constraint yz_ordenes_neto_tipo_venta_check
  check (tipo_venta is null or tipo_venta in ('directa', 'reventa'));

-- Cero dejó de poder significar a la vez "no leído" y "saldo confirmado".
-- Las filas históricas positivas ya eran comprobablemente reales; las nuevas
-- escrituras marcan también saldos confirmados en cero o negativos.
alter table public.ventas_diarias
  add column if not exists neto_confirmado boolean not null default false;
update public.ventas_diarias
set neto_confirmado = true
where neto > 0 and not neto_confirmado;

alter table public.yz_ventas_diarias
  add column if not exists neto_confirmado boolean not null default false;
update public.yz_ventas_diarias
set neto_confirmado = true
where neto > 0 and not neto_confirmado;

create or replace function ventas_resumen_sku(
  p_account uuid, p_desde date, p_hasta date,
  p_prev_desde date, p_prev_hasta date, p_hoy date
)
returns table (
  sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric,
  neto_resuelto numeric, importe_neto_real numeric, comision_neto_real numeric,
  neto_real numeric, unidades_hoy bigint, unidades_prev bigint
)
language sql stable security definer set search_path = public as $$
  select v.sku,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(case when v.neto_confirmado and v.neto is not null then v.neto
                      else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
             filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= least(p_prev_desde, p_desde)
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  group by v.sku;
$$;

create or replace function yz_ventas_resumen(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric,
  neto numeric, unidades_sin_neto bigint, importe_sin_neto numeric, comision_sin_neto numeric
)
language sql stable security definer set search_path = public as $$
  select v.sku,
    sum(v.unidades)::bigint,
    sum(v.ordenes)::bigint,
    sum(v.importe),
    sum(v.comision),
    coalesce(sum(v.neto) filter (where v.neto_confirmado), 0),
    coalesce(sum(v.unidades) filter (where not v.neto_confirmado), 0)::bigint,
    coalesce(sum(v.importe) filter (where not v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where not v.neto_confirmado), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;

create or replace function yz_ventas_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (fecha date, unidades bigint, importe numeric, neto numeric, importe_sin_neto numeric, comision_sin_neto numeric)
language sql stable security definer set search_path = public as $$
  select v.fecha, sum(v.unidades)::bigint, sum(v.importe),
    coalesce(sum(v.neto) filter (where v.neto_confirmado), 0),
    coalesce(sum(v.importe) filter (where not v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where not v.neto_confirmado), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.fecha order by v.fecha;
$$;

create or replace function yz_netos_observados(p_account uuid, p_desde date, p_hasta date)
returns table (ordenes_con_neto bigint, total numeric, neto numeric, ordenes_pendientes bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where o.neto_en is not null or o.neto > 0)::bigint,
    coalesce(sum(o.total) filter (where o.neto_en is not null or o.neto > 0), 0),
    coalesce(sum(coalesce(o.neto_actual, o.neto)) filter (where o.neto_en is not null or o.neto > 0), 0),
    count(*) filter (where o.neto_en is null and not (o.neto > 0) and o.total > 0)::bigint
  from yz_ordenes_neto o
  where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account));
$$;

create or replace function yz_cortes_ventas_desde_ordenes(p_account uuid, p_desde date, p_hasta date)
returns table (sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.order_id, o.fecha, o.total, o.renglones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  dias as (
    select o.fecha, bool_or(o.total > 0 and not o.neto_conocido) as incompleto
    from o group by o.fecha
  ),
  r as (
    select o.order_id, o.fecha, o.neto_hoy, o.neto_conocido,
      x->>'sku' as sku,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce((x->>'importe')::numeric, 0) as importe,
      coalesce((x->>'comision')::numeric, 0) as comision,
      sum(coalesce((x->>'importe')::numeric, 0)) over (partition by o.order_id) as importe_orden
    from o, jsonb_array_elements(o.renglones) as x
  )
  select r.sku, r.fecha,
    sum(r.unidades)::bigint,
    count(*)::bigint,
    sum(r.importe),
    sum(r.comision),
    case when d.incompleto then 0
         else round(sum(case when r.neto_conocido and r.importe_orden > 0
                             then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end
  from r join dias d on d.fecha = r.fecha
  where r.sku is not null
  group by r.sku, r.fecha, d.incompleto;
$$;

-- Versiones con marcador explícito para el corte mensual. El faltante se
-- calcula por SKU|día: un saldo confirmado en cero/negativo sigue siendo real,
-- mientras otro SKU pendiente del mismo día conserva su estimación.
create or replace function yz_cortes_ventas_desde_ordenes_confirmadas(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, fecha date, unidades bigint, ordenes bigint, importe numeric,
  comision numeric, neto numeric, neto_confirmado boolean
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.order_id, o.fecha, o.total, o.renglones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  r as (
    select o.order_id, o.fecha, o.total, o.neto_hoy, o.neto_conocido,
      x->>'sku' as sku,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce((x->>'importe')::numeric, 0) as importe,
      coalesce((x->>'comision')::numeric, 0) as comision,
      sum(coalesce((x->>'importe')::numeric, 0)) over (partition by o.order_id) as importe_orden
    from o, jsonb_array_elements(o.renglones) as x
  )
  select r.sku, r.fecha,
    sum(r.unidades)::bigint,
    count(*)::bigint,
    sum(r.importe),
    sum(r.comision),
    case when bool_or(r.total > 0 and not r.neto_conocido) then 0
         else round(sum(case when r.neto_conocido and r.importe_orden > 0
                             then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end,
    not bool_or(r.total > 0 and not r.neto_conocido)
  from r
  where r.sku is not null
  group by r.sku, r.fecha;
$$;

create or replace function yz_ventas_renglones_confirmados(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, fecha date, unidades int, ordenes int, importe numeric,
  comision numeric, neto numeric, neto_confirmado boolean
)
language sql stable security definer set search_path = public as $$
  select v.sku, v.fecha, v.unidades, v.ordenes, v.importe, v.comision, v.neto, v.neto_confirmado
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  order by v.fecha, v.sku;
$$;

drop function if exists cortes_ordenes_por_dia(uuid, date, date);
create function cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, dev_en_neto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric,
  dev_costo numeric, dev_unidades bigint, dev_sin_costo_unidades bigint, dev_sin_renglones_monto numeric,
  comision_mp numeric, envio_mp numeric, isr_mp numeric, iva_mp numeric, otros_mp numeric,
  cargos_sin_desglosar numeric, ajuste_liquidacion numeric, cargos_leidos bigint, netos_leidos bigint,
  reembolsos_base_pendientes bigint
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
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar,
      o.cargos_leidos_en, o.neto_en,
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
    count(*) filter (where o.estado is distinct from 'cancelled' and o.reembolso > 0 and not o.base_confiable)::bigint
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
  reembolsos_base_pendientes bigint
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
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar,
      o.cargos_leidos_en, o.neto_en,
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
    count(*) filter (where o.estado is distinct from 'cancelled' and o.reembolso > 0 and not o.base_confiable)::bigint
  from o left join devc on devc.fecha = o.fecha
  group by o.fecha order by o.fecha;
$$;

drop function if exists cortes_desglose_por_sku(uuid, date, date);
create function cortes_desglose_por_sku(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, neto numeric, comision_mp numeric, envio_mp numeric, isr_mp numeric,
  iva_mp numeric, otros_mp numeric, cargos_sin_desglosar numeric, ajuste_liquidacion numeric
)
language sql stable security definer set search_path = public as $$
  with r as (
    select o.order_id, x->>'sku' as sku,
      coalesce((x->>'importe')::numeric, 0) as importe,
      sum(coalesce((x->>'importe')::numeric, 0)) over (partition by o.order_id) as importe_orden,
      coalesce(o.neto_actual, o.neto) as neto,
      coalesce(o.comision_mp, 0) as comision_mp,
      coalesce(o.envio_mp, 0) as envio_mp,
      coalesce(o.isr_mp, 0) as isr_mp,
      coalesce(o.iva_mp, 0) as iva_mp,
      coalesce(o.otros_mp, 0) as otros_mp,
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar
      ,(o.neto - coalesce(o.neto_actual, o.neto))
        - greatest(
            0,
            least(
              greatest(0, coalesce(o.reembolsado, 0)),
              least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0)))
                + greatest(0, o.neto - coalesce(o.neto_actual, o.neto))
            )
              - least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0)))
          ) as ajuste_liquidacion
    from ordenes_neto o
    cross join lateral jsonb_array_elements(coalesce(o.renglones, '[]'::jsonb)) x
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled'
      and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  )
  select r.sku,
    sum(r.neto * r.importe / nullif(r.importe_orden, 0)),
    sum(r.comision_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.envio_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.isr_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.iva_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.otros_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.cargos_sin_desglosar * r.importe / nullif(r.importe_orden, 0)),
    sum(r.ajuste_liquidacion * r.importe / nullif(r.importe_orden, 0))
  from r
  where r.sku is not null and r.sku <> '' and r.importe_orden > 0
  group by r.sku
  order by r.sku;
$$;

drop function if exists yz_cortes_desglose_por_sku(uuid, date, date);
create function yz_cortes_desglose_por_sku(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, neto numeric, comision_mp numeric, envio_mp numeric, isr_mp numeric,
  iva_mp numeric, otros_mp numeric, cargos_sin_desglosar numeric, ajuste_liquidacion numeric
)
language sql stable security definer set search_path = public as $$
  with r as (
    select o.order_id, x->>'sku' as sku,
      coalesce((x->>'importe')::numeric, 0) as importe,
      sum(coalesce((x->>'importe')::numeric, 0)) over (partition by o.order_id) as importe_orden,
      coalesce(o.neto_actual, o.neto) as neto,
      coalesce(o.comision_mp, 0) as comision_mp,
      coalesce(o.envio_mp, 0) as envio_mp,
      coalesce(o.isr_mp, 0) as isr_mp,
      coalesce(o.iva_mp, 0) as iva_mp,
      coalesce(o.otros_mp, 0) as otros_mp,
      coalesce(o.cargos_sin_desglosar, 0) as cargos_sin_desglosar
      ,(o.neto - coalesce(o.neto_actual, o.neto))
        - greatest(
            0,
            least(
              greatest(0, coalesce(o.reembolsado, 0)),
              least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0)))
                + greatest(0, o.neto - coalesce(o.neto_actual, o.neto))
            )
              - least(greatest(0, coalesce(o.reembolsado, 0)), greatest(0, coalesce(o.reembolso_incluido_neto_base, 0)))
          ) as ajuste_liquidacion
    from yz_ordenes_neto o
    cross join lateral jsonb_array_elements(coalesce(o.renglones, '[]'::jsonb)) x
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled'
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  )
  select r.sku,
    sum(r.neto * r.importe / nullif(r.importe_orden, 0)),
    sum(r.comision_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.envio_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.isr_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.iva_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.otros_mp * r.importe / nullif(r.importe_orden, 0)),
    sum(r.cargos_sin_desglosar * r.importe / nullif(r.importe_orden, 0)),
    sum(r.ajuste_liquidacion * r.importe / nullif(r.importe_orden, 0))
  from r
  where r.sku is not null and r.sku <> '' and r.importe_orden > 0
  group by r.sku
  order by r.sku;
$$;

revoke all on function cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function cortes_desglose_por_sku(uuid, date, date) from public, anon;
revoke all on function yz_cortes_desglose_por_sku(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ventas_desde_ordenes_confirmadas(uuid, date, date) from public, anon;
revoke all on function yz_ventas_renglones_confirmados(uuid, date, date) from public, anon;
grant execute on function cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function cortes_desglose_por_sku(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_desglose_por_sku(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ventas_desde_ordenes_confirmadas(uuid, date, date) to authenticated, service_role;
grant execute on function yz_ventas_renglones_confirmados(uuid, date, date) to authenticated, service_role;