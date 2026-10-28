DROP TABLE IF EXISTS qs_claims CASCADE;
DROP TABLE IF EXISTS qs_jobs CASCADE;
CREATE TABLE qs_jobs (id int PRIMARY KEY, status text NOT NULL DEFAULT 'new');
CREATE TABLE qs_claims (id serial PRIMARY KEY, job_id int NOT NULL, worker text NOT NULL);
