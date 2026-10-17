{#- Mon to Fri days from a to b inclusive, 0 when a is after b. Matches weekdaysIn() in src/dates.ts. -#}
{% macro weekdays_between(a, b) %}
case
    when ({{ a }})::date > ({{ b }})::date then 0
    else
        ((({{ b }})::date - ({{ a }})::date + 1) // 7) * 5
        + len([
            k for k in range(((({{ b }})::date - ({{ a }})::date + 1) % 7)::bigint)
            if (isodow(({{ a }})::date) - 1 + k) % 7 < 5
        ])
end
{% endmacro %}
