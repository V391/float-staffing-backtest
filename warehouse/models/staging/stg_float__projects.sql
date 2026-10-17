with source as (
    select unnest(projects) as p from {{ ref('base_float__export') }}
)

select
    p.project_id,
    p.project_code,
    p.name as project_name,
    p.client_id,
    p.start_date,
    p.end_date,
    coalesce([lower(t) for t in p.tags], []) as project_tags,
    p.notes
from source
