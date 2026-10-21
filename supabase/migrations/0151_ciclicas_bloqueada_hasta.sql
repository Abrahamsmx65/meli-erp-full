-- Relámpagos cíclicas de TikTok: una relámpago de CREADORES armada a mano en
-- el Seller Center («GT148 SAHORY MONSE MARLU») no es pública y no choca con
-- la cíclica, así que el fondo ya no espera a que termine (dueño,
-- 21-oct-2026: «es para creador, no es pública ni chocan esas»). Si TikTok
-- sí rechaza los productos por otra actividad viva (17029022), la cíclica
-- queda bloqueada hasta que esa termine y el cron no insiste cada minuto.
alter table tiktok_promociones_ciclicas
  add column if not exists bloqueada_hasta timestamptz;

comment on column tiktok_promociones_ciclicas.bloqueada_hasta is
  'TikTok rechazó la cíclica por otra actividad viva; no se reintenta antes de esta hora.';
