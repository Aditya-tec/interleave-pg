DROP TABLE IF EXISTS chk7_accounts CASCADE;
CREATE TABLE chk7_accounts (id int PRIMARY KEY, balance int NOT NULL, CONSTRAINT chk7_nonneg CHECK (balance >= 0));
