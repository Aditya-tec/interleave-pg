DROP TABLE IF EXISTS dl2_transfers CASCADE;
DROP TABLE IF EXISTS dl2_accounts CASCADE;
CREATE TABLE dl2_accounts (id int PRIMARY KEY, balance int NOT NULL);
CREATE TABLE dl2_transfers (id serial PRIMARY KEY, src int NOT NULL, dst int NOT NULL, amount int NOT NULL);
