DROP TABLE IF EXISTS bookings CASCADE;
CREATE TABLE bookings (id serial PRIMARY KEY, room int NOT NULL, start_h int NOT NULL, end_h int NOT NULL);
