// Show the source and rendered output of the same Markdown, parsed only once.
export const blocks = {
  example: {
    figure: false,
    lex(body, token, api) {
      token.source = body.trim();
      api.block(body, token.tokens);
    },
    render(token, api) {
      return api.div(token,
        `<div class="example-source"><div class="example-label">Markdown</div><pre><code>${api.esc(token.source)}</code></pre></div>` +
        `<div class="example-result"><div class="example-label">Result</div>${api.parse(token.tokens)}</div>`);
    },
  },
  square: {
    figure: false,
    render() {
      return '<div class="square-demo"><label>x <input type="range" min="1" max="10" value="3"></label><output aria-live="polite">3² = 9</output></div>';
    },
  },
};

export const spans = {
  bars(argument) {
    const values = argument.split(',').map(Number);
    if (values.length > 20 || values.some(value => !Number.isFinite(value) || value < 0 || value > 10)) {
      throw new Error('bars: use up to 20 comma-separated numbers from 0 to 10');
    }
    return `<svg class="demo-bars" viewBox="0 0 ${values.length * 24} 100" role="img" aria-label="Bars: ${values.join(', ')}">` +
      values.map((value, i) => `<rect x="${i * 24 + 2}" y="${100 - value * 10}" width="20" height="${value * 10}" rx="2"/>`).join('') + '</svg>';
  },
};

export const browser = ['./examples.js'];
