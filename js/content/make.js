// Compact constructors for the content files. They build the same objects as the
// literals in content.js. Never change an id once published: it is stored in each
// user's history.
//
// quiz() shuffles the options with a seed derived from the id, so authors can always
// put the correct answer first, yet the order is the same on every device and load.
// The log stores the index the user picked, so don't edit a published quiz's options.
export function maker(topic, cat) {
  return {
    fact: (id, level, wiki, title, text) =>
      ({ id, topic, cat, level, type: 'fact', wiki, title, text }),
    quiz: (id, level, wiki, question, written, answer, explain) => {
      const correct = written[answer];
      const options = shuffle(written, id);
      return { id, topic, cat, level, type: 'quiz', wiki, question, options, answer: options.indexOf(correct), explain };
    },
  };
}

function shuffle(list, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
