DROP TABLE IF EXISTS spd_users CASCADE;
CREATE TABLE spd_users (id serial PRIMARY KEY, email text NOT NULL, CONSTRAINT spd_email_unique UNIQUE (email));
