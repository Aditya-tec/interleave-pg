DROP TABLE IF EXISTS wallets CASCADE;
CREATE TABLE wallets (owner text PRIMARY KEY, cents int NOT NULL);
