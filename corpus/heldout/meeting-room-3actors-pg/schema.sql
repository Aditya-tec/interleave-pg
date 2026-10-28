DROP TABLE IF EXISTS reservations CASCADE;
CREATE TABLE reservations (id serial PRIMARY KEY, room_id int NOT NULL, starts int NOT NULL, ends int NOT NULL, who text NOT NULL);
