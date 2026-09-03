-- ============================================================================
--  TikTok: muestras gratis y lo que de verdad se recibe por pedido.
--
--  · es_muestra: las solicitudes de muestra de los creadores llegan como
--    pedidos de $0 (TikTok las marca con is_sample_order). Se despachan
--    igual y descuentan el kardex igual, pero NO son ventas: no cuentan en
--    unidades ni en importe. Se ven aparte.
--  · neto_recibido / liquidacion: lo que TikTok liquida por el pedido
--    (ingreso − comisiones − envío), leído del API de finanzas cuando el
--    pedido ya está entregado y en un estado de cuenta. Hasta entonces
--    queda null y la pantalla lo dice ("sin liquidar").
--  · liquidacion_intento_en: para no preguntarle a TikTok por el mismo
--    pedido en cada corrida de 15 minutos.
-- ============================================================================

alter table public.tiktok_ordenes
  add column if not exists es_muestra boolean not null default false,
  add column if not exists neto_recibido numeric,
  add column if not exists liquidado_en timestamptz,
  add column if not exists liquidacion jsonb,
  add column if not exists liquidacion_intento_en timestamptz;

update public.tiktok_ordenes set es_muestra = true where total = 0 and es_muestra = false;
