with source as (
    select unnest(clients) as c from {{ ref('base_float__export') }}
)

select
    c.client_id,
    c.name as client_name
from source
