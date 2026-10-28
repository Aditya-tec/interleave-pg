DROP TABLE IF EXISTS redemptions; DROP TABLE IF EXISTS coupons;
CREATE TABLE coupons (code text PRIMARY KEY, remaining int NOT NULL);
CREATE TABLE redemptions (id serial PRIMARY KEY, code text NOT NULL, user_id int NOT NULL, UNIQUE (code, user_id));
