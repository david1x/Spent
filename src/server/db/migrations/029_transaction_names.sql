-- The user's own words for a transaction. Bank descriptions are often cryptic
-- ("חיוב צק/12345/0001002/10"), so a row can carry a name the user chose,
-- shown in place of the description, and a free-text note.
--
-- `description` itself stays as the bank sent it: the dedup hash, merchant
-- matching and categorizing all read it, and a sync must recognize the row.
ALTER TABLE transactions ADD COLUMN display_name TEXT;
ALTER TABLE transactions ADD COLUMN note TEXT;
