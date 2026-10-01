-- Precios para TikTok: el precio que el dueño QUIERE poner por modelo
-- (relámpago normal); de ahí salen el live (−5 %) y la campaña (+5 %).
-- Dueño, 1-oct-2026: «yo quiero el precio que yo quiero poner».
create table if not exists public.tiktok_precios_objetivo (
  account_id uuid not null references public.meli_accounts(id) on delete cascade,
  modelo text not null,
  precio numeric not null check (precio > 0),
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.tiktok_precios_objetivo enable row level security;

drop policy if exists tiktok_precios_objetivo_mias on public.tiktok_precios_objetivo;
create policy tiktok_precios_objetivo_mias on public.tiktok_precios_objetivo
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
