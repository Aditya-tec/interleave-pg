DROP TABLE IF EXISTS nd_audit; DROP TABLE IF EXISTS nd_wallet;
CREATE TABLE nd_wallet (id int PRIMARY KEY, balance int NOT NULL);
CREATE TABLE nd_audit (id serial PRIMARY KEY, token text NOT NULL);
