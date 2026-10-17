-- One row per staffing decision: every allocation to a real person (history) or to a
-- role placeholder (an open role). History is judged as of the project's start date.
with allocations as (
    select * from {{ ref('stg_float__allocations') }}
),

people as (
    select * from {{ ref('stg_float__people') }}
),

projects as (
    select * from {{ ref('stg_float__projects') }}
),

team_roles as (
    select project_id, people_id, min(role_id) as role_id
    from {{ ref('stg_float__project_team') }}
    group by 1, 2
)

select
    a.task_id as decision_id,
    a.project_id,
    pr.client_id,
    pr.project_tags,
    coalesce(t.role_id, pe.role_id) as role_id,
    a.start_date,
    a.end_date,
    a.hours_per_day,
    pe.is_role_placeholder as is_open,
    case when pe.is_role_placeholder then null else a.people_id end as chosen_people_id,
    case
        when pe.is_role_placeholder then '{{ var("as_of_today") }}'::date
        else pr.start_date
    end as as_of_date,
    greatest(1, {{ weekdays_between('a.start_date', 'a.end_date') }}) as window_weekdays
from allocations as a
inner join people as pe on pe.people_id = a.people_id
inner join projects as pr on pr.project_id = a.project_id
left join team_roles as t on t.project_id = a.project_id and t.people_id = a.people_id
where (pe.is_schedulable or pe.is_role_placeholder)
  and coalesce(t.role_id, pe.role_id) is not null
