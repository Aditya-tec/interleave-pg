DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS counters CASCADE;
CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);
CREATE TABLE events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
