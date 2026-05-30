/**
 * Verifies that the JSON / YAML / TOML adapters select the correct
 * react-json-view-lite base stylesheet based on the active theme:
 *   - light theme → built on defaultStyles
 *   - dark theme  → built on darkStyles
 *
 * The adapters wrap that base via jsonViewStyles() to recolor the value/key
 * classes (token-aligned, see json-view-theme.css), so the `style` prop is no
 * longer the library object by reference — it carries the base's identity
 * marker (`__token`) plus our override class names. The library is mocked to
 * capture the prop; the mock is hoisted via vi.hoisted so it installs before
 * the adapter modules import the library.
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
    it(`${label}: builds the style on defaultStyles under light theme`, () => {
      setTheme("paper");
      const Preview = format.genericPreview!;
      render(<Preview content={content} path={path ?? null} diagnostics={[]} />);
      expect(jsonViewMock).toHaveBeenCalled();
      const style = jsonViewMock.mock.calls.at(-1)?.[0]?.style;
      // Carries the light base's identity marker...
      expect(style.__token).toBe(defaultStyles.__token);
      // ...and our token-aligned value overrides.
      expect(style.stringValue).toBe("vmark-json-view__string");
    });

    it(`${label}: builds the style on darkStyles under dark theme`, () => {
      setTheme("night");
      const Preview = format.genericPreview!;
      render(<Preview content={content} path={path ?? null} diagnostics={[]} />);
      expect(jsonViewMock).toHaveBeenCalled();
      const style = jsonViewMock.mock.calls.at(-1)?.[0]?.style;
      expect(style.__token).toBe(darkStyles.__token);
      expect(style.stringValue).toBe("vmark-json-view__string");
    });
  }

  it("rebuilds on the dark base after a light → dark theme switch (json)", () => {
    setTheme("paper");
    const Preview = jsonFormat.genericPreview!;
    const { rerender } = render(
      <Preview content='{"a":1}' path="/x/a.json" diagnostics={[]} />,
    );
    expect(jsonViewMock.mock.calls.at(-1)?.[0]?.style.__token).toBe(
      defaultStyles.__token,
    );

    setTheme("night");
    rerender(<Preview content='{"a":1}' path="/x/a.json" diagnostics={[]} />);
    expect(jsonViewMock.mock.calls.at(-1)?.[0]?.style.__token).toBe(
      darkStyles.__token,
    );
  });
});
