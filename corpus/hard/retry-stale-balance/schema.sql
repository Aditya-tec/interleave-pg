DROP TABLE IF EXISTS rt1_accounts CASCADE;
CREATE TABLE rt1_accounts (id int PRIMARY KEY, balance int NOT NULL, version int NOT NULL DEFAULT 0);
