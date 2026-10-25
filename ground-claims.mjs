// Deterministic claim grounding: the model cites post NUMBERS from the
// numbered sample it was shown; this maps them back to the sampled posts
// (text+link) and derives the support count from the mapping. Out-of-range,
// non-numeric and duplicate ids are dropped; claims with no valid citation
// are dropped. A valid citation means the model pointed at a real sampled
// post - it does not independently prove the post entails the claim.
export function groundClaims(arr, sample, { max = 5, textMax = 200, postTextMax = 280 } = {}) {
  return (Array.isArray(arr) ? arr : []).map(c => {
    const idx = [...new Set((Array.isArray(c && c.posts) ? c.posts : []).map(n => Math.trunc(Number(n))).filter(n => Number.isInteger(n) && n >= 1 && n <= sample.length))];
    const cited = idx.map(n => ({ text: String(sample[n - 1].text || '').slice(0, postTextMax), link: sample[n - 1].link || null }));
    const text = String(c && c.text || '').trim().slice(0, textMax);
    return cited.length && text ? { text, support: cited.length, posts: cited } : null;
  }).filter(Boolean).slice(0, max);
}
