DROP TABLE IF EXISTS cas2_accounts CASCADE;
CREATE TABLE cas2_accounts (id int PRIMARY KEY, balance int NOT NULL, version int NOT NULL DEFAULT 0);
