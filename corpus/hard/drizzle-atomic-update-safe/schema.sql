DROP TABLE IF EXISTS dz2_bookings CASCADE;
DROP TABLE IF EXISTS dz2_slots CASCADE;
CREATE TABLE dz2_slots (id int PRIMARY KEY, capacity int NOT NULL, taken int NOT NULL DEFAULT 0);
CREATE TABLE dz2_bookings (id serial PRIMARY KEY, slot_id int NOT NULL, who text NOT NULL);
