-- ============================================================================
--  El seguro contra el doble descuento tenía que ser un índice COMPLETO.
--
--  La 0030 lo creó como índice parcial (`where referencia is not null`), y
--  Postgres NO puede inferir un índice parcial en un `ON CONFLICT (…)`: la
--  sincronización tronaba con "there is no unique or exclusion constraint
--  matching the ON CONFLICT specification" en el primer pedido enviado.
--
--  El índice completo protege exactamente igual: en Postgres los NULL son
--  distintos entre sí dentro de un índice único, así que los movimientos
--  capturados a mano (sin referencia) siguen pudiendo repetirse cuantas
--  veces haga falta — dos entradas de 10 pares del mismo SKU son dos
--  entradas — mientras que un pedido de TikTok, que sí trae referencia,
--  sigue sin poder descontar dos veces.
-- ============================================================================

drop index if exists public.tiktok_movimientos_referencia_unica;

create unique index if not exists tiktok_movimientos_referencia_unica
  on public.tiktok_movimientos (account_id, tipo, referencia, sku);
