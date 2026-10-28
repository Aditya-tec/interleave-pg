DROP TABLE IF EXISTS wh1_ledger CASCADE;
DROP TABLE IF EXISTS wh1_events CASCADE;
CREATE TABLE wh1_events (event_id text PRIMARY KEY);
CREATE TABLE wh1_ledger (id serial PRIMARY KEY, event_id text NOT NULL, amount int NOT NULL);
