-- ============================================================================
--  Mecanismo de defensa del corte: renglones que NO se confirman.
--
--  Cuando falta stock de un SKU (o pasa una falla como la del GT102-GREY-25
--  del 14-sep-2026, que se ofreció sin tener pares), el dueño quiere poder
--  cancelar en TikTok SOLO ese SKU del pedido y confirmar lo demás —en un
--  pedido grande no se pierde todo por un par—, y que el corte nunca lo
--  confirme por error. Pedido del dueño el 16-sep-2026.
--
--  El renglón bloqueado se queda en tiktok_orden_items con su motivo. Al
--  hacer el corte, antes de confirmar el pedido se le pide a TikTok que
--  CANCELE esos renglones (cancelación parcial); si TikTok acepta, se
--  confirma el resto; si no, el pedido ENTERO se queda fuera del corte y
--  se declara. Confirmar con un par que no existe es el error caro.
-- ============================================================================

alter table public.tiktok_orden_items
  add column if not exists bloqueado_en timestamptz,
  add column if not exists bloqueo_motivo text,
  add column if not exists bloqueo_por uuid references auth.users (id) on delete set null,
  -- cómo terminó: 'cancelado' (TikTok lo canceló) o el error que contestó
  add column if not exists bloqueo_resultado text,
  add column if not exists bloqueo_resuelto_en timestamptz;

create index if not exists tiktok_orden_items_bloqueados_idx
  on public.tiktok_orden_items (account_id, order_id)
  where bloqueado_en is not null and bloqueo_resuelto_en is null;

comment on column public.tiktok_orden_items.bloqueado_en is
  'Renglón que el corte NO debe confirmar: se cancela en TikTok antes de confirmar el resto del pedido.';
