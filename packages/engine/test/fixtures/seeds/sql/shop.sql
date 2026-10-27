DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS products;
CREATE TABLE products (id int PRIMARY KEY, stock int NOT NULL);
CREATE TABLE orders (id serial PRIMARY KEY, product_id int NOT NULL);
