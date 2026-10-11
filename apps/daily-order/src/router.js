/* Hash routing: "#/dashboard", "#/wallet", … The shell (main.js) listens for changes. */
export const ROUTES = ['dashboard', 'tasks', 'planner', 'gym', 'wallet'];
export const DEFAULT_ROUTE = 'dashboard';

export function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(id) ? id : DEFAULT_ROUTE;
}

export function go(id) {
  if (currentRoute() === id && location.hash) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  location.hash = `#/${id}`;
}
