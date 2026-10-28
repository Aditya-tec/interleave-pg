DROP TABLE IF EXISTS dl1_transfers CASCADE;
DROP TABLE IF EXISTS dl1_accounts CASCADE;
CREATE TABLE dl1_accounts (id int PRIMARY KEY, balance int NOT NULL);
CREATE TABLE dl1_transfers (id serial PRIMARY KEY, src int NOT NULL, dst int NOT NULL, amount int NOT NULL);
