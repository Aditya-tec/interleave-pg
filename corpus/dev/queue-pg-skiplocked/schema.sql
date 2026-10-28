DROP TABLE IF EXISTS claims CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
CREATE TABLE jobs (id int PRIMARY KEY, status text NOT NULL);
CREATE TABLE claims (id serial PRIMARY KEY, job_id int NOT NULL, worker text NOT NULL);
