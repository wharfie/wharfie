SELECT
    resource_id,
    operation_id,
    operation_type,
    action_type,
    MIN(from_iso8601_timestamp(timestamp)) AS start_time,
    MAX(from_iso8601_timestamp(timestamp)) AS end_time,
    to_unixtime(MAX(from_iso8601_timestamp(timestamp))) - to_unixtime(MIN(from_iso8601_timestamp(timestamp))) AS duration_seconds
FROM logs
WHERE operation_id is not null
GROUP BY resource_id, operation_id, operation_type, action_type
ORDER BY resource_id, operation_id, duration_seconds desc;
