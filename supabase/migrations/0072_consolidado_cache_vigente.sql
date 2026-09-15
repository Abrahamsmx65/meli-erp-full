-- El corte general de un mes CERRADO se refresca solo cada 6 horas, así que
-- no veía lo que la recarga de pagos reales de Mercado Pago, el cron de
-- netos de fundas o la ingesta de la Finances API de Amazon iban
-- escribiendo (agosto seguía con retenciones en $0 mientras la base ya las
-- tenía). Como app_cache y yz_cache, el renglón ahora se puede marcar
-- obsoleto y la pantalla lo sirve declarándolo y lo rehace en el fondo.
alter table public.consolidado_cache
  add column if not exists vigente boolean not null default true,
  add column if not exists motivo  text;
