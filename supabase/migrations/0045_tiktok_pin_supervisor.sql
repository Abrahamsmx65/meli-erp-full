-- ============================================================================
--  Clave de supervisor para la estación de "Preparar pedidos" de TikTok.
--
--  Un paquete se da por preparado escaneando etiqueta y producto. Cuando eso
--  no se puede (código ilegible, escáner descompuesto), el dueño permite
--  cerrarlo SIN escanear, pero con una clave que solo él y el encargado
--  saben. La clave vive aquí, en la tabla de RLS con cero políticas (solo
--  service_role la lee), y se compara en tiempo constante en
--  `acceso-preparar.ts`, el único lugar que convierte token o clave en
--  permiso. El valor NO va en el repo: se captura directo en la base.
-- ============================================================================

alter table public.tiktok_acceso
  add column if not exists pin_supervisor text;
