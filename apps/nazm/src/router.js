/* Hash routing: "#/home", "#/gym", "#/money", "#/me". Unknown hashes go to Home. */
export const ROUTES = ['home', 'gym', 'money', 'me'];
export const DEFAULT_ROUTE = 'home';

export function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(id) ? id : DEFAULT_ROUTE;
}

export function go(id) {
  if (currentRoute() === id && location.hash) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  location.hash = `#/${id}`;
}
