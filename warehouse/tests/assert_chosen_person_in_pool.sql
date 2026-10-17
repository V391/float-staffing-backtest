-- Every historical decision's actual pick must be in its candidate pool,
-- otherwise the backtest silently scores that decision as a miss.
select d.decision_id, d.chosen_people_id
from {{ ref('int_staffing_decisions') }} as d
left join {{ ref('fct_candidate_signals') }} as f
    on f.decision_id = d.decision_id and f.people_id = d.chosen_people_id
where not d.is_open
  and f.decision_id is null
