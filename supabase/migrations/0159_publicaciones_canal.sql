-- Las publicaciones nuevas hechas desde el ERP ahora también pueden ser de
-- Amazon (12-nov-2026): `canal` dice de cuál es cada renglón. Lo que ya
-- había es de MELI.

alter table meli_publicaciones add column if not exists canal text not null default 'meli';
