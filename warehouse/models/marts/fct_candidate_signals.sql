-- Candidate pool and history signals for every staffing decision, using only what was
-- known at the decision's as_of_date. Mirrors FeatureBuilder.candidates() in src/features.ts;
-- tests/assert_ts_sql_feature_parity.sql checks the two agree row for row.
with decisions as (
    select * from {{ ref('int_staffing_decisions') }}
),

people as (
    select * from {{ ref('stg_float__people') }} where is_schedulable
),

team as (
    select distinct project_id, people_id from {{ ref('stg_float__project_team') }}
),

history as (
    select * from {{ ref('int_person_project_history') }}
),

-- Allocations with their project's start, the date that decides when they became known.
known_allocations as (
    select a.*, pr.start_date as project_start
    from {{ ref('stg_float__allocations') }} as a
    inner join {{ ref('stg_float__projects') }} as pr on pr.project_id = a.project_id
),

-- Other real people already on the decision's project (not the person being chosen).
teammates as (
    select d.decision_id, t.people_id
    from decisions as d
    inner join team as t on t.project_id = d.project_id
    inner join people as p on p.people_id = t.people_id
    where t.people_id is distinct from d.chosen_people_id
),

employed as (
    select
        d.*,
        p.people_id as candidate_id,
        p.capacity_hours_per_day,
        p.skill_tags
    from decisions as d
    cross join people as p
    where (p.start_date is null or p.start_date <= d.start_date)
      and (p.end_date is null or p.end_date >= d.end_date)
      and not exists (
          select 1 from teammates as tm
          where tm.decision_id = d.decision_id and tm.people_id = p.people_id
      )
),

booked as (
    select
        e.decision_id,
        e.candidate_id,
        coalesce(sum(
            a.hours_per_day
            * {{ weekdays_between('greatest(a.start_date, e.start_date)', 'least(a.end_date, e.end_date)') }}
            / e.window_weekdays
        ), 0) as booked_hours
    from employed as e
    left join known_allocations as a
        on a.people_id = e.candidate_id
        and a.project_id <> e.project_id
        and a.project_start < e.as_of_date
    group by 1, 2
),

past_projects as (
    select e.decision_id, e.candidate_id, e.client_id as decision_client_id, h.project_id, h.client_id, h.project_start
    from employed as e
    inner join history as h on h.people_id = e.candidate_id and h.project_start < e.as_of_date
),

history_signals as (
    select
        decision_id,
        candidate_id,
        count(*) filter (where client_id is not null and client_id = decision_client_id) as same_client_projects,
        max(project_start) as latest_history_start
    from past_projects
    group by 1, 2
),

known_people as (
    select distinct pp.decision_id, pp.candidate_id, t.people_id as known_id
    from past_projects as pp
    inner join team as t on t.project_id = pp.project_id
),

teammates_known as (
    select k.decision_id, k.candidate_id, count(*) as teammates_known
    from known_people as k
    inner join teammates as tm on tm.decision_id = k.decision_id and tm.people_id = k.known_id
    group by 1, 2
)

select
    e.decision_id,
    e.candidate_id as people_id,
    e.as_of_date,
    e.is_open,
    coalesce(e.candidate_id = e.chosen_people_id, false) as is_chosen,
    coalesce(hs.same_client_projects, 0) as same_client_projects,
    coalesce(tk.teammates_known, 0) as teammates_known,
    len(list_intersect(e.skill_tags, e.project_tags)) as skill_matches,
    b.booked_hours,
    e.capacity_hours_per_day - b.booked_hours as free_hours,
    hs.latest_history_start
from employed as e
inner join booked as b on b.decision_id = e.decision_id and b.candidate_id = e.candidate_id
left join history_signals as hs on hs.decision_id = e.decision_id and hs.candidate_id = e.candidate_id
left join teammates_known as tk on tk.decision_id = e.decision_id and tk.candidate_id = e.candidate_id
-- Free enough to take the role at the requested hours per day.
where e.capacity_hours_per_day - b.booked_hours >= e.hours_per_day - 1e-9
