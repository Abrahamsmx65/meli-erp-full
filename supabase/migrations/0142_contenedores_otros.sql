-- Lo que viaja en el contenedor y NO es calzado (bolsas de empaque del
-- S268-2026, cajas, etiquetas): sale del packing list, se enseña con el
-- contenedor y cuenta contra el BL, pero nunca se amarra con un pedido ni
-- cuenta como inventario. Dueño, 11-oct-2026.
alter table contenedores add column if not exists otros jsonb;
