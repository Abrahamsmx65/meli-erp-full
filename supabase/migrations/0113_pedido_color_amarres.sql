-- Amarre a mano del COLOR de un pedido con el color publicado en MELI
-- (pedido del dueño, 7-oct-2026: «ligar lo que no está dentro de los
-- pedidos: que me ponga lo que MELI tiene, lo marque en rojo por afuera y
-- cuando me meta salgan las variantes de ese modelo y yo elija cómo
-- ligarlo»). La fábrica escribe «NAVY (AZUL MARINO)» y MELI «BLUE»: el
-- renglón del pedido conserva la escritura de la fábrica (así amarra el
-- packing list) y este renglón dice a qué color de MELI corresponde. Es
-- por modelo + color aplastado, no por pedido: la misma escritura se repite
-- en los pedidos siguientes. `color_meli` NULL = el dueño confirmó que es un
-- color NUEVO de verdad (no se grita más, no se liga a nada).
create table if not exists public.pedido_color_amarres (
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  modelo      text not null,
  color       text not null,
  color_meli  text,
  color_pedido text not null,
  creado_en   timestamptz not null default now(),
  primary key (account_id, modelo, color)
);

comment on table public.pedido_color_amarres is
  'Color escrito en el pedido de la fábrica → color publicado en MELI, por modelo. color_meli NULL = confirmado como color nuevo.';
comment on column public.pedido_color_amarres.modelo is 'modelo canonizado (GT074)';
comment on column public.pedido_color_amarres.color is 'color del pedido aplastado (NAVYAZULMARINO)';
comment on column public.pedido_color_amarres.color_pedido is 'color del pedido tal cual se escribió, para enseñarlo';

alter table public.pedido_color_amarres enable row level security;
drop policy if exists pedido_color_amarres_mios on public.pedido_color_amarres;
create policy pedido_color_amarres_mios on public.pedido_color_amarres
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
