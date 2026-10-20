# Life is Life

A variant of Conway's Game of Life. It starts from a single digestive cell and aims to reach biodiversity and intelligence.

**Idea and concept:** Davide Brunori, University of Genoa, 2026.

**Try it:** open `index.html` in your browser.

## The rules

1. All cells reproduce by doubling.
2. Every cell has a specialization: **digestive** (red), **tactile** (pink) or **visual** (blue).
3. The first cell is digestive: it is hungry, has low resistance and feels pleasure when it eats.
4. The reproductive number *k* can evolve: an organism with *k* gives rise to two organisms of *k* cells.
5. If *k* > 1, cells can specialize. A large organism can eat single cells of smaller organisms.
6. Every cell has a list of orders to give the organism for each stimulus.
7. The organism always chooses the behavior supported by the most cells.
8. A cell that receives no stimuli is converted into another specialization.
9. A digestive cell that is digesting is busy and cannot eat.
10. A wrong choice causes pain: the cells that made it randomly mutate their order for that stimulus.
11. A trapped organism, unable to move, dies.
12. At least one cell in every three is digestive; an organism without digestion dies.

Also: a mutable diet (herbivore, carnivore, omnivore), growth by eating beyond satiety, food that can be pushed with a strength proportional to body size, and edges that wrap around.

## How to play

- **Click** an organism to inspect it (diet, energy, orders).
- **Shift + click** to drop food.
- The sliders control speed, amount of food and plasticity (how much pain changes the orders).

## Files

- `index.html`: the page.
- `app.js`: drawing, controls, statistics and the organism inspector.
- `style.css`: the page style.
- `sim.js`: the simulation engine, plain JavaScript with no dependencies. It also runs in Node.js:

```js
const LL = require('./sim.js');
const sim = LL.createSim({ seed: 7 });
for (let i = 0; i < 10000; i++) sim.update();
console.log(sim.stats);
```

## How to cite

If you use or build on this simulator, please cite:

> Brunori, D. (2026). *Life is Life: an evolutionary cellular simulator*. University of Genoa.

```bibtex
@software{brunori2026lifeislife,
  author      = {Brunori, Davide},
  title       = {Life is Life: an evolutionary cellular simulator},
  year        = {2026},
  institution = {University of Genoa}
}
```

## License

MIT. See [LICENSE](LICENSE).
