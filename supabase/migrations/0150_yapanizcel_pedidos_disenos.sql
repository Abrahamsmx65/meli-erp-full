-- Pedidos a China de fundas: los diseños que el dueño ELIGE para pedir se
-- guardan por cuenta, no solo en el navegador. Hasta el 20-oct-2026 la
-- elección vivía en localStorage y en la URL: cambiar de equipo o de
-- navegador la perdía, y al cargar la pantalla se recortaba contra los
-- diseños que el resumen traía en ese momento (dueño: «no se desligan solos,
-- se quedan guardados»).
alter table yz_parametros
  add column if not exists pedidos_disenos text[] not null default '{}';

comment on column yz_parametros.pedidos_disenos is
  'Diseños elegidos en Pedidos a China (se conservan hasta que el dueño los quite).';
