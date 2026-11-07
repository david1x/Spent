-- Foreign purchases that the card bills in their own currency.
--
-- Isracard puts dollar and euro purchases on a separate foreign-currency part
-- of the statement and converts them only when the card is charged. Until
-- then its "billing amount" is the foreign amount itself, which was stored as
-- shekels: $50 counted as ₪50. Such rows get charged_estimated = 1 so the UI
-- can mark them with "≈". The rate below (implied by the user's own converted
-- purchases) is only a first pass: on startup, src/server/lib/fx-rates.ts
-- recomputes every estimate from the Bank of Israel rate on the purchase day
-- (migration 026). A later sync that reports the real shekel amount replaces
-- the estimate.

ALTER TABLE transactions ADD COLUMN charged_estimated INTEGER NOT NULL DEFAULT 0;

-- CAL writes symbols ("$") where Isracard writes ISO codes ("USD").
CREATE TEMP VIEW _fx_norm AS
SELECT id,
       CASE original_currency
         WHEN '$' THEN 'USD' WHEN '€' THEN 'EUR' WHEN '£' THEN 'GBP'
         ELSE upper(original_currency)
       END AS currency,
       original_amount, charged_amount, type
FROM transactions;

CREATE TEMP TABLE _fx_rates AS
SELECT currency, AVG(ABS(charged_amount) / ABS(original_amount)) AS rate
FROM _fx_norm
WHERE type = 'normal'
  AND original_amount <> 0
  AND charged_amount <> original_amount
  AND currency NOT IN ('ILS', '₪', 'NIS')
GROUP BY currency;

-- Fallbacks for a currency with no converted purchase yet.
INSERT INTO _fx_rates (currency, rate)
SELECT v.currency, v.rate
FROM (SELECT 'USD' AS currency, 3.1 AS rate
      UNION ALL SELECT 'EUR', 3.5
      UNION ALL SELECT 'GBP', 4.1) AS v
WHERE v.currency NOT IN (SELECT currency FROM _fx_rates);

UPDATE transactions
SET charged_amount = ROUND(original_amount * (
      SELECT r.rate FROM _fx_rates r JOIN _fx_norm n ON n.currency = r.currency
      WHERE n.id = transactions.id
    ), 2),
    charged_estimated = 1
WHERE charged_amount = original_amount
  AND original_amount <> 0
  AND original_currency NOT IN ('ILS', '₪', 'NIS')
  AND EXISTS (
    SELECT 1 FROM _fx_rates r JOIN _fx_norm n ON n.currency = r.currency
    WHERE n.id = transactions.id
  );

DROP TABLE _fx_rates;
DROP VIEW _fx_norm;
