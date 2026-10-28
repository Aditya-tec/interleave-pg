DROP TABLE IF EXISTS purchases CASCADE; DROP TABLE IF EXISTS seats CASCADE;
CREATE TABLE seats (id int PRIMARY KEY, buyer text);
CREATE TABLE purchases (id serial PRIMARY KEY, seat_id int NOT NULL, buyer text NOT NULL);
