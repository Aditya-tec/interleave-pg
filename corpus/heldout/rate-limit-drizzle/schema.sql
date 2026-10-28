DROP TABLE IF EXISTS allowed CASCADE; DROP TABLE IF EXISTS quota CASCADE;
CREATE TABLE quota (user_id int PRIMARY KEY, used int NOT NULL, max_requests int NOT NULL);
CREATE TABLE allowed (id serial PRIMARY KEY, user_id int NOT NULL);
