with source as (
    select unnest(timeoffs) as t from {{ ref('base_float__export') }}
),

per_person as (
    select t.timeoff_id, t.start_date, t.end_date, unnest(t.people_ids) as people_id from source
)

select timeoff_id, people_id, start_date, end_date
from per_person
