-- The app is English now: rename the automatic tests that were created with Romanian names.
-- Overviews, page checks and run messages refresh on their own at the next scan/run.
update public.tests t set name = v.name
from (values
  ('availability', 'Site is up'),
  ('speed', 'Page loads in under 5 seconds'),
  ('content', 'Page content is visible'),
  ('ssl', 'SSL certificate is valid'),
  ('https_redirect', 'HTTP redirects to HTTPS'),
  ('js_errors', 'No JavaScript errors'),
  ('broken_links', 'Links on the page work'),
  ('broken_images', 'Images load'),
  ('mobile', 'Page displays correctly on phones'),
  ('load_experience', 'Loading looks right (preloader, sideways scroll)'),
  ('slow_network', 'Loads acceptably on slow 4G')
) as v(key, name)
where t.essential_key = v.key;

-- Queue a fresh scan of every finished site so overviews are regenerated in English
update public.sites set scan_status = 'pending' where scan_status in ('done', 'error');
