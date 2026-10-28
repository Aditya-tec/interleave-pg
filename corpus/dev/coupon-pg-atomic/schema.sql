DROP TABLE IF EXISTS redemptions CASCADE;
DROP TABLE IF EXISTS coupons CASCADE;
CREATE TABLE coupons (code text PRIMARY KEY, used boolean NOT NULL DEFAULT false);
CREATE TABLE redemptions (id serial PRIMARY KEY, code text NOT NULL);
