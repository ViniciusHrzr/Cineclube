function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const words = name => String(name || '').trim().split(/\s+/).filter(Boolean);

function handlesFor(reviewers) {
  const list = (reviewers || []).map(r => ({ id: String(r.id), parts: words(r.name) }));

  const chosen = {};
  let pending = list;
  for (let depth = 1; depth <= 3 && pending.length; depth++) {
    const bucket = {};
    for (const person of pending) {
      const handle = norm(person.parts.slice(0, depth).join('')) || 'membro';
      (bucket[handle] ||= []).push(person);
    }
    const next = [];
    for (const [handle, people] of Object.entries(bucket)) {
      const taken = Object.values(chosen).includes(handle);
      if (people.length === 1 && !taken) chosen[people[0].id] = handle;
      else next.push(...people);
    }
    pending = next;
  }

  for (const person of pending) {
    const base = norm(person.parts.join('')) || 'membro';
    chosen[person.id] = `${base}${norm(person.id).slice(-3)}`;
  }
  return chosen;
}

function mentionedIn(body, handles) {
  const text = String(body || '');
  if (!text.includes('@')) return [];

  const byHandle = Object.entries(handles).sort((a, b) => b[1].length - a[1].length);
  const found = new Set();

  for (const [id, handle] of byHandle) {
    const at = new RegExp(`(^|[^a-zA-Z0-9@._-])@${handle}(?![a-z0-9])`, 'i');
    if (at.test(norm2(text))) found.add(id);
  }
  return [...found];
}

function norm2(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

module.exports = { handlesFor, mentionedIn };
