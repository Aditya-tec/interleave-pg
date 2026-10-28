DROP TABLE IF EXISTS seat6_bookings CASCADE;
CREATE TABLE seat6_bookings (id serial PRIMARY KEY, seat int NOT NULL, who text NOT NULL, CONSTRAINT seat6_one_booking UNIQUE (seat));
