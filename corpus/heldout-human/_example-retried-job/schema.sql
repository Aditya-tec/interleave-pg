DROP TABLE IF EXISTS emails_sent CASCADE;
DROP TABLE IF EXISTS job_state CASCADE;
CREATE TABLE job_state (job_id text PRIMARY KEY, done boolean NOT NULL DEFAULT false);
CREATE TABLE emails_sent (id serial PRIMARY KEY, job_id text NOT NULL, to_addr text NOT NULL);
