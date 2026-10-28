DROP TABLE IF EXISTS def8_assign CASCADE;
CREATE TABLE def8_assign (
  id serial PRIMARY KEY,
  task int NOT NULL,
  worker text NOT NULL,
  CONSTRAINT def8_one_worker UNIQUE (task) DEFERRABLE INITIALLY DEFERRED
);
