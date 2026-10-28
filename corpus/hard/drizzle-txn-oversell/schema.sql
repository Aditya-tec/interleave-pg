DROP TABLE IF EXISTS dz1_bookings CASCADE;
DROP TABLE IF EXISTS dz1_slots CASCADE;
CREATE TABLE dz1_slots (id int PRIMARY KEY, capacity int NOT NULL);
CREATE TABLE dz1_bookings (id serial PRIMARY KEY, slot_id int NOT NULL, who text NOT NULL);
