/** Round axis ticks from 0 to just above `max`: about `count` steps of 1, 2, 5 or 10 × a power of 10. */
export function niceTicks(max: number, count = 4): number[] {
  const top = Math.max(max, 1);
  const rough = top / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let v = 0; v < top + step; v += step) {
    ticks.push(Number(v.toFixed(6)));
    if (v >= top) break;
  }
  return ticks;
}
