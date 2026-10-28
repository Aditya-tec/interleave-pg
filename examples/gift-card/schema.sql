DROP TABLE IF EXISTS gift_cards;
CREATE TABLE gift_cards (
  code    text PRIMARY KEY,
  balance integer NOT NULL
);
