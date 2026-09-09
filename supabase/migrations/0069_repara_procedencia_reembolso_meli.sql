-- Repara filas alcanzadas por una versión previa del backfill de 0066.
-- Una orden nunca leída no tiene procedencia contable todavía. Tampoco es
-- demostrable una base cero histórica con reembolso si el desglose aún no fue
-- releído por la aplicación.

update public.ordenes_neto
set reembolso_incluido_neto_base = null,
    reembolso_base_confiable = null
where neto_en is null
   or (
     coalesce(reembolsado, 0) > 0
     and coalesce(reembolso_incluido_neto_base, 0) = 0
     and reembolso_base_confiable is true
     and cargos_leidos_en is null
   );

update public.yz_ordenes_neto
set reembolso_incluido_neto_base = null,
    reembolso_base_confiable = null
where neto_en is null
   or (
     coalesce(reembolsado, 0) > 0
     and coalesce(reembolso_incluido_neto_base, 0) = 0
     and reembolso_base_confiable is true
     and cargos_leidos_en is null
   );