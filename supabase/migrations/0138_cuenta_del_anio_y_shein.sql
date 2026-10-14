-- CUENTA DEL AÑO (dueño, 11-oct-2026): «esta cuenta es de mayo 2026 a abril
-- 2027, cada año hacemos así las cuentas»; «la cuenta con Rafa es solo las
-- de transferencias […] el total es conmigo, no con él»; y la cuenta de
-- SHEIN «me la tienes que sumar a mí también como ganancia».
--
-- · `ejercicio` = el año en que EMPIEZA la cuenta (2026 = 1-may-2026 al
--   30-abr-2027). Lo que trae fecha cae solo por su fecha; lo que no (la
--   renta de oficina de 12 meses, los contenedores) lleva el ejercicio
--   apuntado. Por omisión, el ejercicio en curso.
-- · Movimiento `shein`: lo que sale de la cuenta de Shein (renta y
--   mercancía; negativo = mercancía devuelta). Los depósitos de Shein ya son
--   transferencias (beneficiario DEPOSITO SHEIN).
-- · `socios.recibe_shein`: a quién se le suma lo que deja Shein.

create or replace function public.ejercicio_actual() returns int
language sql stable as $$
  select case when extract(month from (now() at time zone 'America/Mexico_City')) >= 5
              then extract(year from (now() at time zone 'America/Mexico_City'))
              else extract(year from (now() at time zone 'America/Mexico_City')) - 1 end::int
$$;

alter table public.costeo_contenedores
  add column if not exists ejercicio int default public.ejercicio_actual();
update public.costeo_contenedores set ejercicio = 2026 where ejercicio is null;

alter table public.cuenta_paralela
  add column if not exists ejercicio int default public.ejercicio_actual();
update public.cuenta_paralela
  set ejercicio = case when fecha is null then 2026
                       when extract(month from fecha) >= 5 then extract(year from fecha)::int
                       else extract(year from fecha)::int - 1 end
  where ejercicio is null;
alter table public.cuenta_paralela drop constraint if exists cuenta_paralela_tipo_check;
alter table public.cuenta_paralela add constraint cuenta_paralela_tipo_check
  check (tipo in ('transferencia', 'ingreso', 'gasto', 'shein'));

alter table public.socios add column if not exists recibe_shein boolean not null default false;
update public.socios set recibe_shein = true where upper(nombre) like 'ABRAHAM%';

-- Salidas de la pestaña CUENTA SHEIN (importadas una vez; el sheet nunca se escribe).
insert into public.cuenta_paralela (account_id, fecha, tipo, monto, beneficiario, ejercicio, clave_importacion)
select a.id, v.fecha::date, 'shein', v.monto, v.concepto, 2026, 'cuentas:shein:' || v.n
from public.meli_accounts a
cross join (values
  (1, '2026-05-05', 24360.00, 'RENTA MAYO'),
  (2, '2026-06-05', 24360.00, 'RENTA JUNIO'),
  (3, '2026-06-11', 93443.79, 'MERCANCIA'),
  (4, '2026-06-30', 5904.36, 'MERCANCIA'),
  (5, '2026-07-06', 27346.80, 'MERCANCIA'),
  (6, '2026-07-10', 83466.48, 'MERCANCIA'),
  (7, '2026-07-15', 1552.46, 'MERCANCIA'),
  (8, '2026-07-15', 24360.00, 'RENTA JULIO'),
  (9, '2026-08-03', 25668.48, 'RENTA AGOSTO'),
  (10, '2026-08-10', 76270.56, 'MERCANCIA'),
  (11, '2026-08-21', 28980.10, 'MERCANCIA'),
  (12, '2026-08-27', 80575.23, 'MERCANCIA'),
  (13, '2026-09-05', 25668.48, 'RENTA SEP'),
  (14, '2026-09-15', 73243.70, 'MERCANCIA'),
  (15, '2026-09-18', 83513.30, 'MERCANCIA'),
  (16, '2026-09-18', -9732.11, 'MERCANCIA DEVUELTA'),
  (17, '2026-09-23', 11358.85, 'MERCANCIA'),
  (18, '2026-09-05', 25668.48, 'RENTA SEP'),
  (19, '2026-10-05', 25668.48, 'RENTA OCT'),
  (20, '2026-10-09', 46348.35, 'MERCANCIA')
) as v (n, fecha, monto, concepto)
where a.id = 'd1876076-09ea-487a-ab8f-b3e9a4c8faf2'
on conflict (account_id, clave_importacion) do nothing;
