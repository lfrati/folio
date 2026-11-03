// Demo-specific behavior; the engine embeds this script in the generated page.
(() => {
  for (const widget of document.querySelectorAll('.square-demo')) {
    const input = widget.querySelector('input');
    const output = widget.querySelector('output');
    const update = () => {
      const value = Number(input.value);
      output.textContent = `${value}² = ${value * value}`;
    };
    input.addEventListener('input', update);
    update();
  }
})();
