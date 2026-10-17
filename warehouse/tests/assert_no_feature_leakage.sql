-- A decision may only use projects that had started before it was made.
-- Any row here means a feature saw the future, which would inflate the backtest.
select decision_id, people_id, as_of_date, latest_history_start
from {{ ref('fct_candidate_signals') }}
where latest_history_start >= as_of_date
