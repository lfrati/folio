// Table of contents: mark the heading nearest the top of the viewport as current.
(function () {
  const links = [...document.querySelectorAll('.toc a')];
  if (!links.length) return;
  const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if (!targets.length) return;
  function update() {
    let cur = targets[0];
    for (const t of targets) if (t.getBoundingClientRect().top <= 80) cur = t;
    links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === '#' + cur.id));
  }
  document.addEventListener('scroll', update, { passive: true });
  update();
})();

// Cross-reference previews: hovering a @ref link (Lemma 1, Table 2, Fig. 3, (1), …) or a
// citation shows a floating copy of the referenced block next to the link.
(function () {
  let pop = null, showTimer = 0, hideTimer = 0;
  const cancel = () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  function hide() { cancel(); if (pop) { pop.remove(); pop = null; } }
  // a block inside `::: ai` or `::: wip` keeps its marking when shown on its own
  function marked(target, copy) {
    const block = target.closest('.ai, .wip');
    if (!block || block === target) return copy;
    const kind = block.classList.contains('ai') ? 'ai' : 'wip';
    const wrapper = document.createElement('div');
    wrapper.className = kind;
    if (kind === 'ai') {
      const label = document.createElement('p');
      label.className = 'ai-label';
      label.textContent = 'AI draft';
      wrapper.appendChild(label);
    }
    wrapper.appendChild(copy);
    return wrapper;
  }
  function show(link) {
    hide();
    const target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
    if (!target) return;
    pop = document.createElement('div');
    pop.className = 'preview';
    const copy = target.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    pop.appendChild(marked(target, copy));
    pop.addEventListener('mouseenter', cancel);
    pop.addEventListener('mouseleave', () => { hideTimer = setTimeout(hide, 150); });
    document.body.appendChild(pop);
    // below the link if there is room, else above, else as low as fits; always inside the viewport
    const r = link.getBoundingClientRect(), gap = 6;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - gap) top = r.top - gap - h >= 0 ? r.top - gap - h : Math.max(gap, window.innerHeight - h - gap);
    const left = Math.max(gap, Math.min(r.left, window.innerWidth - w - gap));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }
  for (const link of document.querySelectorAll('a.ref:not(.bad), a.cite:not(.bad)')) {
    link.addEventListener('mouseenter', () => { cancel(); showTimer = setTimeout(() => show(link), 120); });
    link.addEventListener('mouseleave', () => { cancel(); hideTimer = setTimeout(hide, 150); });
    link.addEventListener('click', hide);
  }
  document.addEventListener('scroll', hide, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
})();
