with source as (
    select unnest(roles) as r from {{ ref('base_float__export') }}
)

select
    r.id as role_id,
    r.name as role_name
from source
