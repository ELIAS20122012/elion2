/* Hash routing: "#/today", "#/money", "#/gym". Unknown hashes (including old ones) go to Today. */
export const ROUTES = ['today', 'money', 'gym'];
export const DEFAULT_ROUTE = 'today';

export function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(id) ? id : DEFAULT_ROUTE;
}

export function go(id) {
  if (currentRoute() === id && location.hash) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  location.hash = `#/${id}`;
}
