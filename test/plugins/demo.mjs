// A minimal plugin for the tests: one span prefix, one fence, one comment handler.
export const spans = { box: arg => `<b class="box">${arg}</b>` };
export const fences = { echo: body => `<pre class="echo">${body}</pre>` };
export function comments(body) { if (body.trim().startsWith('keep:')) return `<i>${body.trim().slice(5).trim()}</i>`; }
export const browser = ['./demo.js'];
export const styles = ['./demo.css'];
export const blocks = { demo: { render: (t, api) => api.div(t, `<section>${api.parse(t.tokens)}</section>`) } };
