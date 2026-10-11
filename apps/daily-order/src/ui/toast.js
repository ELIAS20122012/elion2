let el;
let timer;

/** Show a short message; `action` ({label, run}) adds an inline button (e.g. undo). */
export function toast(msg, action) {
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = '<span></span>';
  el.firstChild.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.run(); };
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), action ? 4000 : 2400);
}
