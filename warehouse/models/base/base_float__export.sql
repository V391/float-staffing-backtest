-- The raw Float API export (one row, one list column per endpoint), as pulled by src/pull.ts.
-- In production this would be CDC tables landed by Debezium/Kafka instead of a JSON snapshot.
select *
from read_json('{{ var("float_export_path") }}', maximum_object_size = 67108864)
