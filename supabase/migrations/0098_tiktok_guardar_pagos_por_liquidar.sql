-- Guarda de un jalón lo que TikTok dice que va a pagar por cada pedido
-- (la lista de sin liquidar, ~5,300 pedidos por lectura). Antes eran
-- 5,300 UPDATE uno por uno desde Vercel (~200 s por corrida del sync, que
-- pasó de ~60 s a 250–316 s y tumbó dos corridas por tiempo el
-- 28-sep-2026). Un pedido ya LIQUIDADO no se toca: su número es el del
-- estado de cuenta.
create or replace function public.tiktok_guardar_pagos_por_liquidar(p_account_id uuid, p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.tiktok_ordenes o
     set pago_leido_en = now(),
         pago_estado = 'por_liquidar',
         pago_esperado = f.pago_esperado,
         pago_afiliado = f.pago_afiliado,
         liquidacion = f.liquidacion,
         pago_desglose = f.pago_desglose
    from jsonb_to_recordset(p_filas) as f(order_id text, pago_esperado numeric, pago_afiliado numeric, liquidacion jsonb, pago_desglose jsonb)
   where o.account_id = p_account_id
     and o.order_id = f.order_id
     and (o.pago_estado is null or o.pago_estado <> 'liquidado');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.tiktok_guardar_pagos_por_liquidar(uuid, jsonb) from public, anon, authenticated;
