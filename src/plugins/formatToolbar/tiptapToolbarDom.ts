export function createToolbarButton(opts: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `format-toolbar-btn${opts.active ? " active" : ""}`;
  btn.title = opts.title;
  btn.innerHTML = opts.icon;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  return btn;
}

export function createToolbarRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "format-toolbar-row";
  return row;
}

export function createToolbarSeparator(): HTMLElement {
  const separator = document.createElement("div");
  separator.className = "format-toolbar-separator";
  return separator;
}
