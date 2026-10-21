-- Pedidos a China de fundas: solo se pide un SKU cuando le FALTAN al menos
-- `pedido_minimo` unidades (50), y lo que se pide se redondea HACIA ARRIBA
-- al múltiplo `pedido_multiplo` (10). Algunos diseños se fabrican en otro
-- múltiplo (el 662 va de 20 en 20: «es 40 o 60, no 50»): `pedido_multiplos`
-- guarda ese múltiplo por diseño, {"662": 20}. Dueño, 21-oct-2026.
alter table yz_parametros
  add column if not exists pedido_minimo integer not null default 50,
  add column if not exists pedido_multiplo integer not null default 10,
  add column if not exists pedido_multiplos jsonb not null default '{}'::jsonb;

comment on column yz_parametros.pedido_minimo is
  'Pedidos a China: un SKU solo se pide si le faltan al menos estas unidades.';
comment on column yz_parametros.pedido_multiplo is
  'Pedidos a China: lo pedido se redondea hacia arriba a este múltiplo.';
comment on column yz_parametros.pedido_multiplos is
  'Pedidos a China: múltiplo por diseño cuando difiere del general, {"662": 20}.';

update yz_parametros
  set pedido_multiplos = pedido_multiplos || '{"662": 20}'::jsonb
  where not (pedido_multiplos ? '662');
