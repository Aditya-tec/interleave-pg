DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS idem_keys CASCADE;
CREATE TABLE idem_keys (key text PRIMARY KEY);
CREATE TABLE payments (id serial PRIMARY KEY, amount int NOT NULL);
