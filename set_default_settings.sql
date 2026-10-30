-- Default roles & permission levels applied to every new rex_path row
-- (fires BEFORE INSERT via trigger trg_default_settings).
CREATE OR REPLACE FUNCTION public.set_default_settings()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.settings = NEW.settings || '{
    "permissionLevels": [
      {"color": "black",       "label": "Guest",        "level": 0},
      {"color": "dodgerblue",  "label": "Staff",        "level": 10},
      {"color": "forestgreen", "label": "Dept Head",    "level": 20},
      {"color": "crimson",     "label": "Facility Mgr", "level": 30},
      {"color": "fuchsia",     "label": "Global Admin", "level": 40}
    ],
    "roles": [
      {"code": "d", "label": "Developer"},
      {"code": "l", "label": "Legal"},
      {"code": "s", "label": "Security"}
    ]
  }'::jsonb;
  RETURN NEW;
END;
$function$;
