-- 0081 — Lo que el packing list NO pudo amarrar se queda EN EL CONTENEDOR
--
-- El packing list de la fábrica trae renglones que el pedido no tiene con
-- ese nombre (S260-2026, 10-sep-2026: "M Brown" donde el pedido dice
-- "LT BROWN") o que ya viajan en otro contenedor. Hasta hoy esas cajas se
-- perdían en silencio: entraron 399 de 611 y solo quedó "omitidos: 3" en la
-- bitácora de Drive. Ahora cada renglón que no entró completo se guarda con
-- el contenedor —qué es, cuántas cajas y por qué— para que el dueño lo vea
-- en el borrador, elija el renglón del pedido que sí es, y lo confirme ahí.
--
-- Forma: [{ modelo, color, talla, cajas, motivo }]
alter table contenedores add column if not exists pendientes jsonb;

comment on column contenedores.pendientes is
  'Renglones del packing list que no amarraron con el pedido: [{modelo,color,talla,cajas,motivo}]. Se limpian al confirmarlos en la pantalla.';
