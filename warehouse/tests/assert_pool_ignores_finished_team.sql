-- A replayed decision must not rule anyone out for being on the project's finished team.
-- Any row here is a team member who was employed, had the hours, had no other booking in
-- the window, and still went missing from the pool.
select d.decision_id, t.people_id
from {{ ref('int_staffing_decisions') }} as d
inner join {{ ref('stg_float__project_team') }} as t on t.project_id = d.project_id
inner join {{ ref('stg_float__people') }} as p on p.people_id = t.people_id and p.is_schedulable
left join {{ ref('fct_candidate_signals') }} as s
    on s.decision_id = d.decision_id and s.people_id = t.people_id
where not d.is_open
  and s.people_id is null
  and (p.start_date is null or p.start_date <= d.start_date)
  and (p.end_date is null or p.end_date >= d.end_date)
  and p.capacity_hours_per_day >= d.hours_per_day
  and not exists (
      select 1
      from {{ ref('stg_float__allocations') }} as a
      where a.people_id = t.people_id
        and a.project_id <> d.project_id
        and a.start_date <= d.end_date
        and a.end_date >= d.start_date
  )
