-- Which projects each real person has worked on, with what is needed to judge it "as of" a date.
select distinct
    a.people_id,
    a.project_id,
    pr.client_id,
    pr.start_date as project_start
from {{ ref('stg_float__allocations') }} as a
inner join {{ ref('stg_float__people') }} as pe on pe.people_id = a.people_id and pe.is_schedulable
inner join {{ ref('stg_float__projects') }} as pr on pr.project_id = a.project_id
