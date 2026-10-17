-- The SQL models and the TypeScript feature builder (out/ts-features.csv from
-- `npm run dump-features`) must produce the same candidate pools and signals.
with ts as (
    select * from read_csv('{{ var("ts_features_path") }}', header = true)
),

sql_side as (
    select * from {{ ref('fct_candidate_signals') }}
)

select
    coalesce(s.decision_id, ts.decision_id) as decision_id,
    coalesce(s.people_id, ts.people_id) as people_id,
    case
        when s.decision_id is null then 'only in TypeScript'
        when ts.decision_id is null then 'only in SQL'
        when s.same_client_projects <> ts.same_client_projects then 'same_client_projects'
        when s.teammates_known <> ts.teammates_known then 'teammates_known'
        when s.skill_matches <> ts.skill_matches then 'skill_matches'
        when abs(s.booked_hours - ts.booked_hours) > 0.001 then 'booked_hours'
        when s.is_chosen is distinct from (ts.is_chosen = 1) then 'is_chosen'
    end as mismatch
from sql_side as s
full outer join ts on ts.decision_id = s.decision_id and ts.people_id = s.people_id
where s.decision_id is null
   or ts.decision_id is null
   or s.same_client_projects <> ts.same_client_projects
   or s.teammates_known <> ts.teammates_known
   or s.skill_matches <> ts.skill_matches
   or abs(s.booked_hours - ts.booked_hours) > 0.001
   or s.is_chosen is distinct from (ts.is_chosen = 1)
