DROP TABLE IF EXISTS stock CASCADE;
CREATE TABLE stock (sku text PRIMARY KEY, on_hand int NOT NULL, reserved int NOT NULL);
