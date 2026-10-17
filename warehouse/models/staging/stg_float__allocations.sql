with source as (
    select unnest(tasks) as t from {{ ref('base_float__export') }}
)

select
    t.task_id,
    t.project_id,
    t.people_id,
    t.start_date,
    t.end_date,
    t.hours::double as hours_per_day
from source
