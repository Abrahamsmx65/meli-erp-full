-- Las órdenes de fundas SIN depósito leído, de la más nueva a la más vieja:
-- es la primera lectura de `completarNetosPendientes`. Con solo el índice
-- de «cualquier pendiente» (~98 mil renglones, casi todos con depósito y
-- sin envío) encontrar las ~400 sin depósito tardaba 7.1 s y, con los 8 s
-- del statement_timeout, la corrida de netos moría (9-oct-2026).
create index if not exists yz_ordenes_neto_sin_neto_idx
  on public.yz_ordenes_neto (account_id, fecha desc)
  where neto_en is null and total > 0;
