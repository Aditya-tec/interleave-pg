DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS processed_events CASCADE;
CREATE TABLE processed_events (event_id text PRIMARY KEY);
CREATE TABLE deliveries (id serial PRIMARY KEY, event_id text NOT NULL, note text);
