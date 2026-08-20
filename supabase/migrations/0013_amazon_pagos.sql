-- Pagos de Amazon (reporte de liquidación / settlement): el NETO real
-- depositado por SKU y día de asiento — precio cobrado menos comisiones,
-- envío e impuestos, con los reembolsos en negativo. Es el equivalente del
-- net_received_amount de Mercado Pago, pero del lado de Amazon.
--
-- La clave incluye el settlement para que reprocesar un reporte reescriba
-- exactamente lo mismo (idempotente) en vez de duplicar.

create table if not exists public.amazon_pagos (
  account_id     uuid not null references public.amazon_accounts(id) on delete cascade,
  settlement_id  text not null,
  seller_sku     text not null,
  fecha          date not null,
  neto           numeric not null default 0,
  unidades       integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, settlement_id, seller_sku, fecha)
);

create index if not exists amazon_pagos_fecha_idx
  on public.amazon_pagos (account_id, fecha);

alter table public.amazon_pagos enable row level security;

drop policy if exists amazon_pagos_mias on public.amazon_pagos;
create policy amazon_pagos_mias on public.amazon_pagos
  for all
  using (es_mi_cuenta_amazon(account_id))
  with check (es_mi_cuenta_amazon(account_id));
