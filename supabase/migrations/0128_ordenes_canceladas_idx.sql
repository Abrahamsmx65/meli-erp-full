-- `repararCanceladasFalsas` busca las órdenes marcadas canceladas de los
-- últimos 90 días; sin índice recorría ~130 mil renglones por cuenta y, en
-- frío y con su conteo, pasaba de los 8 s del statement_timeout (23 veces
-- del 7 al 9-oct-2026). Las canceladas son pocas: índice parcial.
create index if not exists ordenes_neto_canceladas_idx
  on public.ordenes_neto (account_id, fecha desc)
  where estado = 'cancelled';
create index if not exists yz_ordenes_neto_canceladas_idx
  on public.yz_ordenes_neto (account_id, fecha desc)
  where estado = 'cancelled';
