-- Corte de MUESTRAS (dueño, 22-oct-2026: «una opción nueva en corte que se
-- llame corte muestras; si no se ocupa, se revuelven igual con los cortes
-- normales, pero es por si quiero dar prioridad a muestras cuando tengo
-- muchos pedidos»). Un corte puede nacer solo con los pedidos marcados
-- `tiktok_ordenes.es_muestra`; `muestras` false = corte normal, donde las
-- muestras siguen saliendo revueltas con lo demás.
alter table tiktok_cortes
  add column if not exists muestras boolean not null default false;

comment on column tiktok_cortes.muestras is
  'Corte de MUESTRAS: nació solo con los pedidos marcados es_muestra (dueño, 22-oct-2026). false = corte normal (las muestras van revueltas).';
