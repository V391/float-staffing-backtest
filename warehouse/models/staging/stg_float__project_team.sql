-- Who is on each project, and the project role they were staffed as.
with projects as (
    select unnest(projects) as p from {{ ref('base_float__export') }}
),

members as (
    select p.project_id, unnest(p.project_team) as m from projects
)

select
    project_id,
    m.people_id,
    m.role_id
from members
