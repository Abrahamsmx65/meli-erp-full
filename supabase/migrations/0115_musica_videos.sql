-- La pista de música propia elegida para un video de MODELAJE (pedido del
-- dueño, 7-oct-2026: «el audio no me gusta tanto, revisa otras opciones»):
-- el vigilante reemplaza el audio del video con esta pista al marcarlo.
-- Los videos hablados y los de música de la IA quedan en null.
alter table videos_producto
  add column if not exists musica_url text;
