DROP TABLE IF EXISTS redemptions CASCADE; DROP TABLE IF EXISTS gift_cards CASCADE;
CREATE TABLE gift_cards (code text PRIMARY KEY, balance int NOT NULL);
CREATE TABLE redemptions (id serial PRIMARY KEY, code text NOT NULL, amount int NOT NULL);
