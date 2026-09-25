-- Lo que TikTok va a PAGAR por cada pedido en pie, leído de sus propias
-- transacciones (finanzas 202501, que incluye las aún no liquidadas), no
-- calculado por el ERP (decisión del dueño, 25-sep-2026: «no quiero que me
-- lo calcules tú según estimaciones […] sino revisar exactamente cuánto me
-- pagan, y también hay comisiones a afiliados»). `neto_recibido` sigue
-- siendo SOLO lo ya liquidado; `pago_esperado` es lo que TikTok dice que
-- pagará (liquidado o por liquidar).
alter table public.tiktok_ordenes
  add column if not exists pago_esperado numeric,
  add column if not exists pago_estado text,
  add column if not exists pago_leido_en timestamptz,
  add column if not exists pago_afiliado numeric,
  add column if not exists pago_desglose jsonb;
comment on column public.tiktok_ordenes.pago_esperado is 'Lo que TikTok dice que va a pagar (o pagó) por el pedido: suma de settlement_amount de sus transacciones, liquidadas o no.';
comment on column public.tiktok_ordenes.pago_estado is 'liquidado | por_liquidar | sin_dato (TikTok aún no tiene transacciones del pedido).';
comment on column public.tiktok_ordenes.pago_afiliado is 'Comisión de afiliados (creadores) incluida en las transacciones del pedido, en positivo.';
create index if not exists tiktok_ordenes_pago_leido_idx on public.tiktok_ordenes (account_id, pago_leido_en);
