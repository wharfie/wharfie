SELECT *
FROM logs
WHERE concat(year, '-', month, '-', day) = CAST(current_date AS varchar)
	AND hr = LPAD(CAST(hour(current_timestamp) AS varchar), 2, '0')
ORDER BY timestamp DESC
LIMIT 2000;
