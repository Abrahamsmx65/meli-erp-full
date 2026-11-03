-- La facturación guardada se lee por páginas ordenadas por la llave
-- (`traerTodo`: account_id, detalle_id) filtrando por periodo. Con solo el
-- índice (account_id, periodo) cada página ordenaba el mes completo en disco:
-- mayo de fundas (183 mil renglones) tardaba 2.3 s por página y 184 páginas.
-- Esa carga tumbó el 17-oct-2026 la lectura de octubre del correo diario
-- («yz_cargos: canceling statement due to statement timeout»): fundas salió
-- en cero. Con este índice la página va en orden sin ordenar: 0.2 s.
create index if not exists yz_cargos_periodo_detalle_idx on public.yz_cargos (account_id, periodo, detalle_id);
create index if not exists meli_cargos_periodo_detalle_idx on public.meli_cargos (account_id, periodo, detalle_id);
