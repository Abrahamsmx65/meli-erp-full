-- Medidas y peso de la caja por renglón del contenedor, tal como vienen en el
-- packing list de la fábrica ("Means" 0.66 × 0.56 × 0.24 y "G.W/ctn" 9.5).
-- Alimentan el packing list para el agente aduanal (LARGO, ALTO, ANCHO, PESO).
-- Nulas en lo que se cargó a mano o antes de esta migración.
alter table contenedor_lineas
  add column if not exists largo_cm numeric,
  add column if not exists ancho_cm numeric,
  add column if not exists alto_cm  numeric,
  add column if not exists peso_kg  numeric;
