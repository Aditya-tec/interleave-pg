DROP TABLE IF EXISTS xss_note; DROP TABLE IF EXISTS xss_wallet;
CREATE TABLE xss_wallet (id int PRIMARY KEY, balance int NOT NULL);
CREATE TABLE xss_note (id serial PRIMARY KEY, body text NOT NULL);
