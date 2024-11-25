SELECT 
    action_type,
    date_diff('second', MIN(from_iso8601_timestamp(timestamp)), MAX(from_iso8601_timestamp(timestamp))) AS total_runtime_seconds
FROM logs
WHERE operation_id = '<>'
GROUP BY action_type;