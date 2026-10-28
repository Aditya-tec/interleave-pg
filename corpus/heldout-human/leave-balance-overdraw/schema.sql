DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS leave_balances CASCADE;
CREATE TABLE IF NOT EXISTS leave_balances (employee_id int PRIMARY KEY, days_left int NOT NULL);
CREATE TABLE IF NOT EXISTS leave_requests (id serial PRIMARY KEY, employee_id int NOT NULL, days int NOT NULL);
