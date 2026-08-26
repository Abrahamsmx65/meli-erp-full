-- El guion EXACTO del video: cuando los subtítulos los quema el ERP (no la
-- IA), este texto es la fuente — ortografía perfecta garantizada.
alter table videos_producto add column if not exists guion text;
