-- Ventas de TikTok masticadas y origen de la venta (creadores vs tienda).
--
-- 1-oct-2026. La pantalla /tiktok/ventas bajaba las 12 mil órdenes COMPLETAS
-- (con el JSON crudo del pedido) y los 15 mil renglones bajo RLS en cada
-- apertura; Postgres las cancelaba a los 8 s («Algo falló al cargar esta
-- pantalla») y, cuando alcanzaba, tardaba medio minuto. Dueño: «necesitamos
-- que sea igual que MELI y Amazon, que la info se vaya guardando, no que
-- cada vez jale todo».
--
-- · `creador` / `creador_detalle` / `afiliado_leido_en` en tiktok_ordenes:
--   quién trajo la venta, del endpoint de afiliados de TikTok
--   (`POST /affiliate_seller/202410/orders/search`, `creator_username` por
--   SKU). Un pedido ya revisado sin creador es venta de la TIENDA (nuestra);
--   uno sin revisar todavía se declara aparte, nunca se asume.
-- · `tiktok_ventas_pedidos`: los pedidos de un rango (y los que aún no salen,
--   de cualquier fecha) con sus renglones, de UN jalón y sin el JSON crudo.
--   De aquí mastica `servicios/tiktok-ventas.ts` y guarda en app_cache.
-- · `tiktok_guardar_afiliados` / `tiktok_marcar_afiliados_leidos`: la lectura
--   de afiliados escribe por LOTE (la lección de los 5,300 UPDATE de uno en
--   uno del 28-sep-2026).

alter table public.tiktok_ordenes
  add column if not exists creador text,
  add column if not exists creador_detalle jsonb,
  add column if not exists afiliado_leido_en timestamptz;

comment on column public.tiktok_ordenes.creador is
  'Creador (afiliado) que generó la venta según TikTok; null con afiliado_leido_en = venta de la tienda';
comment on column public.tiktok_ordenes.creador_detalle is
  'Renglones del endpoint de afiliados: creador, product_id, cantidad, tasa y comisión por SKU';
comment on column public.tiktok_ordenes.afiliado_leido_en is
  'Cuándo se revisó el pedido contra el endpoint de afiliados (null = sin revisar)';

create index if not exists tiktok_ordenes_afiliado_idx
  on public.tiktok_ordenes (account_id, afiliado_leido_en);

-- Los pedidos del rango con sus renglones, para masticar la pantalla de
-- ventas. Sin `detalle` (el JSON crudo); del destinatario solo el nombre.
create or replace function public.tiktok_ventas_pedidos(
  p_account uuid,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
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
      'destinatario', o.detalle ->> 'destinatario',
      'creador', o.creador,
      'afiliadoLeido', o.afiliado_leido_en is not null
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
$$;

grant execute on function public.tiktok_ventas_pedidos(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Guarda de un jalón lo que contestó el endpoint de afiliados:
-- p_filas = [{ "orderId": "…", "creador": "…", "detalle": [...] }, …]
create or replace function public.tiktok_guardar_afiliados(
  p_account uuid,
  p_filas jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'tiktok_guardar_afiliados: solo el servicio' using errcode = '42501';
  end if;

  update tiktok_ordenes o
  set creador = f.creador,
      creador_detalle = f.detalle,
      afiliado_leido_en = now()
  from (
    select x ->> 'orderId' as order_id,
           nullif(x ->> 'creador', '') as creador,
           x -> 'detalle' as detalle
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) x
  ) f
  where o.account_id = p_account and o.order_id = f.order_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.tiktok_guardar_afiliados(uuid, jsonb) to service_role;

-- Lo que TikTok NO devolvió en la ventana ya leída completa es venta de la
-- tienda: se marca revisado sin creador.
create or replace function public.tiktok_marcar_afiliados_leidos(
  p_account uuid,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'tiktok_marcar_afiliados_leidos: solo el servicio' using errcode = '42501';
  end if;

  update tiktok_ordenes o
  set afiliado_leido_en = now()
  where o.account_id = p_account
    and o.afiliado_leido_en is null
    and o.fecha_creacion >= p_desde
    and o.fecha_creacion < p_hasta;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.tiktok_marcar_afiliados_leidos(uuid, timestamptz, timestamptz) to service_role;
