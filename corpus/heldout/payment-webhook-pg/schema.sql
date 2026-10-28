DROP TABLE IF EXISTS ledger CASCADE; DROP TABLE IF EXISTS payments CASCADE;
CREATE TABLE payments (id text PRIMARY KEY, status text NOT NULL);
CREATE TABLE ledger (id serial PRIMARY KEY, payment_id text NOT NULL, amount int NOT NULL);
