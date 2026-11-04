-- ============================================================================
--  Por dónde se vendió en TikTok: LIVE, video, tarjeta de producto…
--  (dueño, 4-nov-2026: «saber cuánto fue por live, cuánto por video y cuánto
--  de tarjetas de producto; y en los creadores poder saber si fue de live»).
--
--  1. `tiktok_fuentes_dia`: lo que la ANALÍTICA de TikTok dice por día
--     (`GET /analytics/202609/shop/performance`, granularidad 1D): GMV
--     total y por fuente (LIVE, video, tarjeta de producto, buscador y
--     pestaña Tienda, otros), y cada una partida entre lo nuestro (vendedor)
--     y lo de creadores. Es el número de TikTok, no uno del ERP; el crudo
--     de las ventas del día queda en `datos.crudo` para afinar sin releer.
--  2. `tiktok_ventas_pedidos` entrega por pedido `contenido`: el tipo de
--     contenido (LIVE, VIDEO, SHOP = vitrina del creador, LINKSHARE = enlace)
--     con que el creador del pedido lo vendió, según `creador_detalle` del
--     endpoint de afiliados (el renglón del creador con más pares manda).
-- ============================================================================

create table if not exists public.tiktok_fuentes_dia (
  account_id uuid not null references public.meli_accounts (id) on delete cascade,
  fecha      date not null,
  datos      jsonb not null,
  leido_en   timestamptz not null default now(),
  primary key (account_id, fecha)
);
comment on table public.tiktok_fuentes_dia is
  'Venta de TikTok por fuente (LIVE, video, tarjeta de producto…) por día, leída de la analítica de TikTok Shop.';

alter table public.tiktok_fuentes_dia enable row level security;
create policy tiktok_fuentes_dia_mios on public.tiktok_fuentes_dia
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));
create policy tiktok_fuentes_dia_miembros_tiktok on public.tiktok_fuentes_dia
  for all to authenticated using (account_id in (select mis_cuentas_tiktok())) with check (account_id in (select mis_cuentas_tiktok()));

create or replace function public.tiktok_ventas_pedidos(p_account uuid, p_desde timestamp with time zone, p_hasta timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not (
    es_mi_cuenta(p_account)
    or es_miembro_tiktok(p_account)
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'tiktok_ventas_pedidos: la cuenta % no es tuya', p_account
      using errcode = '42501';
  end if;

  with t as (
    select o.order_id
    from tiktok_ordenes o
    where o.account_id = p_account
      and (
        (o.fecha_creacion >= p_desde and o.fecha_creacion < p_hasta)
        or o.estado in ('UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING')
      )
  ),
  ords as (
    select jsonb_agg(jsonb_build_object(
      'orderId', o.order_id,
      'estado', o.estado,
      'creadoEn', o.fecha_creacion,
      'actualizadoEn', o.fecha_actualizacion,
      'esMuestra', coalesce(o.es_muestra, false),
      'netoRecibido', o.neto_recibido,
      'pagoEsperado', o.pago_esperado,
      'afiliado', o.pago_afiliado,
      'ingreso', o.pago_desglose -> 'ingreso',
      'anuncios', o.pago_desglose -> 'anuncios',
      'destinatario', o.detalle ->> 'destinatario',
      'creador', o.creador,
      'afiliadoLeido', o.afiliado_leido_en is not null,
      'contenido', case when o.creador is null then null else (
        select s ->> 'tipoContenido'
        from jsonb_array_elements(coalesce(o.creador_detalle, '[]'::jsonb)) s
        where s ->> 'creador' = o.creador
        order by coalesce((s ->> 'cantidad')::numeric, 0) desc
        limit 1
      ) end
    )) as j
    from tiktok_ordenes o
    join t on t.order_id = o.order_id
    where o.account_id = p_account
  ),
  rens as (
    select jsonb_agg(jsonb_build_object(
      'orderId', i.order_id,
      'skuInterno', i.sku_interno,
      'sellerSku', i.seller_sku,
      'cantidad', coalesce(i.cantidad, 0),
      'precio', i.precio,
      'estado', i.estado
    )) as j
    from tiktok_orden_items i
    join t on t.order_id = i.order_id
    where i.account_id = p_account
  )
  select jsonb_build_object(
    'ordenes', coalesce((select j from ords), '[]'::jsonb),
    'renglones', coalesce((select j from rens), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;
