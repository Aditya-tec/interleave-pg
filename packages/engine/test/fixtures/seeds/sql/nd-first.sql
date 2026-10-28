DROP TABLE IF EXISTS nd_tokens; DROP TABLE IF EXISTS nd_ctr;
CREATE TABLE nd_tokens (id serial PRIMARY KEY, token text NOT NULL);
CREATE TABLE nd_ctr (id int PRIMARY KEY, n int NOT NULL);
