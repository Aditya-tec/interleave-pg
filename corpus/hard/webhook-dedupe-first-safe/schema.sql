DROP TABLE IF EXISTS wh2_ledger CASCADE;
DROP TABLE IF EXISTS wh2_events CASCADE;
CREATE TABLE wh2_events (event_id text PRIMARY KEY);
CREATE TABLE wh2_ledger (id serial PRIMARY KEY, event_id text NOT NULL, amount int NOT NULL);
