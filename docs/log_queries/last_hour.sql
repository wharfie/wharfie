SELECT *
FROM daemon_logs
WHERE dt = CAST(current_date AS varchar)
	AND hr = CAST(hour(current_timestamp) AS varchar)
ORDER BY timestamp DESC
LIMIT 1000;
