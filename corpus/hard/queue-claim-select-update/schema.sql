DROP TABLE IF EXISTS qc_claims CASCADE;
DROP TABLE IF EXISTS qc_jobs CASCADE;
CREATE TABLE qc_jobs (id int PRIMARY KEY, status text NOT NULL DEFAULT 'new');
CREATE TABLE qc_claims (id serial PRIMARY KEY, job_id int NOT NULL, worker text NOT NULL);
