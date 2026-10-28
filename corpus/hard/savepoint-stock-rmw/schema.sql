DROP TABLE IF EXISTS sp1_orders CASCADE;
DROP TABLE IF EXISTS sp1_stock CASCADE;
CREATE TABLE sp1_stock (sku text PRIMARY KEY, qty int NOT NULL, initial int NOT NULL);
CREATE TABLE sp1_orders (id serial PRIMARY KEY, buyer text NOT NULL, sku text NOT NULL, qty int NOT NULL);
