/**
 * Verifies that the JSON / YAML / TOML adapters select the correct
 * react-json-view-lite stylesheet based on the active theme:
 *   - light theme → defaultStyles
 *   - dark theme  → darkStyles
 *
 * The library is mocked to capture the `style` prop passed to <JsonView />.
 * That gives us a deterministic equality check without depending on the
 * library's internal class names. The mock has to be hoisted via vi.hoisted
 * so it's installed before the adapter modules import the library.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settingsStore";

const { jsonViewMock, defaultStyles, darkStyles } = vi.hoisted(() => {
  const defaultStyles = { __token: "default" };
  const darkStyles = { __token: "dark" };
  return {
    jsonViewMock: vi.fn(),
    defaultStyles,
    darkStyles,
  };
});

vi.mock("react-json-view-lite", () => ({
  JsonView: (props: { data: unknown; style: unknown }) => {
    jsonViewMock(props);
    return null;
  },
  defaultStyles,
  darkStyles,
}));

import { jsonFormat } from "../json";
import { yamlFormat } from "../yaml";
import { tomlFormat } from "../toml";

function setTheme(theme: "paper" | "night"): void {
  act(() => {
    useSettingsStore.setState({
      appearance: {
        ...useSettingsStore.getState().appearance,
        theme,
      },
    });
  });
}

const fixtures: Array<{
  label: string;
  format: typeof jsonFormat;
  content: string;
  path?: string;
}> = [
  {
    label: "json",
    format: jsonFormat,
    content: '{"name":"vmark"}',
    path: "/x/data.json",
  },
  {
    label: "yaml",
    format: yamlFormat,
    content: "name: vmark\nversion: 1\n",
    path: "/x/data.yaml",
  },
  {
    label: "toml",
    format: tomlFormat,
    content: 'name = "vmark"\n',
    path: "/x/data.toml",
  },
];

describe("adapter dark-theme style selection", () => {
  const initialAppearance = useSettingsStore.getState().appearance;

  beforeEach(() => {
    jsonViewMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      useSettingsStore.setState({ appearance: initialAppearance });
    });
  });

  for (const { label, format, content, path } of fixtures) {
    it(`${label}: passes defaultStyles to <JsonView /> under light theme`, () => {
      setTheme("paper");
      const Preview = format.genericPreview!;
      render(<Preview content={content} path={path ?? null} diagnostics={[]} />);
      expect(jsonViewMock).toHaveBeenCalled();
      const style = jsonViewMock.mock.calls.at(-1)?.[0]?.style;
      expect(style).toBe(defaultStyles);
    });

    it(`${label}: passes darkStyles to <JsonView /> under dark theme`, () => {
      setTheme("night");
      const Preview = format.genericPreview!;
      render(<Preview content={content} path={path ?? null} diagnostics={[]} />);
      expect(jsonViewMock).toHaveBeenCalled();
      const style = jsonViewMock.mock.calls.at(-1)?.[0]?.style;
      expect(style).toBe(darkStyles);
    });
  }

  it("re-renders with darkStyles after a light → dark theme switch (json)", () => {
    setTheme("paper");
    const Preview = jsonFormat.genericPreview!;
    const { rerender } = render(
      <Preview content='{"a":1}' path="/x/a.json" diagnostics={[]} />,
    );
    expect(jsonViewMock.mock.calls.at(-1)?.[0]?.style).toBe(defaultStyles);

    setTheme("night");
    rerender(<Preview content='{"a":1}' path="/x/a.json" diagnostics={[]} />);
    expect(jsonViewMock.mock.calls.at(-1)?.[0]?.style).toBe(darkStyles);
  });
});
