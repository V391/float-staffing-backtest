with source as (
    select unnest(people) as p from {{ ref('base_float__export') }}
)

select
    p.people_id,
    p.name as person_name,
    p.role_id,
    p.people_type_id,
    p.people_type_id = 4 as is_role_placeholder,
    p.people_type_id in (1, 2) and p.role_id is not null as is_schedulable,
    p.start_date,
    p.end_date,
    -- Part-timers carry their working hours per weekday; everyone else works 8.
    coalesce(list_avg([h for h in p.work_days_hours if h > 0]), 8)::double as capacity_hours_per_day,
    try_cast(p.cost_rate as double) as cost_rate,
    try_cast(p.default_hourly_rate as double) as bill_rate,
    coalesce([lower(t.name) for t in p.tags], []) as skill_tags
from source
