DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
CREATE TABLE products (id int PRIMARY KEY, stock int NOT NULL);
CREATE TABLE orders (id serial PRIMARY KEY, product_id int NOT NULL);
