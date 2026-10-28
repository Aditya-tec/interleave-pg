DROP TABLE IF EXISTS lim3_audit CASCADE;
DROP TABLE IF EXISTS lim3_wallet CASCADE;
CREATE TABLE lim3_wallet (id int PRIMARY KEY, balance int NOT NULL);
CREATE TABLE lim3_audit (id text PRIMARY KEY, at_ms bigint NOT NULL, note text NOT NULL);
