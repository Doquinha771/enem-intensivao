// Fantasminha em pixel art que reage ao que acontece na prova.
const BODY = [
  '....####....',
  '..########..',
  '.##########.',
  '.##########.',
  '############',
  '############',
  '############',
  '############',
  '############',
  '############',
  '##.###.###.#',
  '#...#...#...',
];

// olhos e boca de cada humor: [x, y, cor] em pixels de 1x1
const FACES = {
  idle:     { eyes: [[3,4],[3,5],[8,4],[8,5]], mouth: [] },
  thinking: { eyes: [[4,4],[9,4]],             mouth: [[6,7],[7,7]] },
  happy:    { eyes: [[2,5],[3,4],[4,5],[7,5],[8,4],[9,5]], mouth: [[4,7],[5,8],[6,8],[7,7]] },
  sad:      { eyes: [[3,5],[4,5],[8,5],[9,5]], mouth: [[5,8],[6,7],[7,8]], tear: [[3,6],[3,7]] },
  panic:    { eyes: [[3,3],[3,4],[3,5],[8,3],[8,4],[8,5]], mouth: [[5,7],[6,7],[5,8],[6,8]] },
};

const LINES = {
  idle:     ['Bora estudar?', 'Uma provinha rapidinha?', 'Linguagens é interpretação. Você consegue.'],
  thinking: ['Hmm, faz sentido...', 'Releu o enunciado?', 'Elimine as que exageram.', 'O texto sempre dá a pista.'],
  happy:    ['Mandou bem!', 'Isso que é leitura!', 'O ENEM que lute.', 'Tô orgulhoso.'],
  sad:      ['Errar faz parte. Bora revisar.', 'Na próxima vai.', 'Lê o comentário que ajuda.'],
  panic:    ['AAAH, tem questão em branco!', 'Calma, ainda dá tempo!', 'Não entrega vazio não!'],
};

const pick = a => a[Math.floor(Math.random() * a.length)];

export function createMascot(root) {
  root.innerHTML = `
    <div class="bubble" hidden></div>
    <svg viewBox="0 0 12 12" width="64" height="64" shape-rendering="crispEdges" aria-hidden="true"></svg>`;
  const svg = root.querySelector('svg');
  const bubble = root.querySelector('.bubble');
  let timer;

  function draw(mood) {
    const f = FACES[mood] || FACES.idle;
    let s = '';
    BODY.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') s += `<rect x="${x}" y="${y}" width="1" height="1" class="g-body"/>`; }));
    f.eyes.concat(f.mouth).forEach(([x, y]) => { s += `<rect x="${x}" y="${y}" width="1" height="1" class="g-face"/>`; });
    (f.tear || []).forEach(([x, y]) => { s += `<rect x="${x}" y="${y}" width="1" height="1" class="g-tear"/>`; });
    svg.innerHTML = s;
    root.dataset.mood = mood;
  }

  function say(text, ms = 3500) {
    bubble.textContent = text;
    bubble.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { bubble.hidden = true; }, ms);
  }

  draw('idle');
  root.addEventListener('click', () => say(pick(LINES[root.dataset.mood] || LINES.idle)));

  return {
    mood(m, text) { draw(m); if (text !== false) say(text || pick(LINES[m] || LINES.idle)); },
    say,
  };
}
