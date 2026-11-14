-- get_user_role picked an arbitrary row (LIMIT 1 with no ORDER BY) when a user has more than one
-- role, so the answer could change between calls. Order by privilege: builder, then employee, then
-- every other role (client, editor), with the role name as the last tie break.
--
-- Same signature, language, volatility, security and search_path as the definition in
-- 20260212040604. CREATE OR REPLACE keeps the grants set by 20261101000020, so none are touched here.

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY
    CASE role::text WHEN 'builder' THEN 0 WHEN 'employee' THEN 1 ELSE 2 END,
    role::text
  LIMIT 1
$$;
