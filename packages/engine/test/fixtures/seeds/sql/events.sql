DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS counters;
CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);
CREATE TABLE events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
