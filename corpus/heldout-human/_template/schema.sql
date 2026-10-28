-- Drop what you create so the file can run again. The engine applies this file at the start of every run.
DROP TABLE IF EXISTS my_table CASCADE;
CREATE TABLE my_table (
  id int PRIMARY KEY,
  n  int NOT NULL
);
