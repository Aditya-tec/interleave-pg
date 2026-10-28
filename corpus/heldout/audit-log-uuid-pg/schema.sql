DROP TABLE IF EXISTS audit CASCADE; DROP TABLE IF EXISTS hits CASCADE;
CREATE TABLE hits (page text PRIMARY KEY, n int NOT NULL);
CREATE TABLE audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), page text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now());
