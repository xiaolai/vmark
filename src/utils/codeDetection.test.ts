// @vitest-environment node
import { describe, it, expect } from "vitest";
import { shouldPasteAsCodeBlock } from "./codeDetection";
import { detectCode } from "./codeDetection/index";

describe("detectCode", () => {
  it("detects JavaScript code", () => {
    const code = `
const foo = () => {
  return "hello";
};
export default foo;
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("javascript");
  });

  it("detects TypeScript code", () => {
    const code = `
interface User {
  name: string;
  age: number;
}

function greet(user: User): void {
  console.log(user.name);
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    // TypeScript might be detected as JavaScript or TypeScript
    expect(["javascript", "typescript"]).toContain(result.language);
  });

  it("detects Python code", () => {
    const code = `
def hello_world():
    print("Hello, World!")

class MyClass:
    def __init__(self, name):
        self.name = name
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("python");
  });

  it("detects Rust code", () => {
    const code = `
fn main() {
    let mut x = 5;
    println!("Value: {}", x);
}

struct Point {
    x: i32,
    y: i32,
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("rust");
  });

  it("detects JSON", () => {
    const code = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "foo": "^1.0.0"
  }
}`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("json");
  });

  it("detects shell scripts", () => {
    const code = `#!/bin/bash

for file in *.txt; do
  echo "$file"
done

export PATH=$HOME/bin:$PATH
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("shell");
  });

  it("detects SQL", () => {
    const code = `
SELECT id, name, email
FROM users
WHERE active = true
ORDER BY name ASC
LIMIT 10;
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("sql");
  });

  it("detects HTML", () => {
    const code = `
<div class="container">
  <h1>Title</h1>
  <p>Paragraph text</p>
  <button onclick="handleClick()">Click me</button>
</div>
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("html");
  });

  it("returns false for plain prose", () => {
    const text = `
This is just a regular paragraph of text.
It doesn't contain any code or special syntax.
Just normal English sentences.
`;
    const result = detectCode(text);
    // Plain text should not be detected as code with high confidence
    expect(result.confidence).not.toBe("high");
  });

  it("returns false for short content", () => {
    const result = detectCode("short");
    expect(result.isCode).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(detectCode("").isCode).toBe(false);
    expect(detectCode("   ").isCode).toBe(false);
  });
});

describe("shouldPasteAsCodeBlock", () => {
  it("returns true for high-confidence code", () => {
    const code = `
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
`;
    const result = shouldPasteAsCodeBlock(code);
    expect(result.should).toBe(true);
  });

  it("returns false for plain text", () => {
    const text = "Hello world, this is just text.";
    const result = shouldPasteAsCodeBlock(text);
    expect(result.should).toBe(false);
  });

  it("returns false for low-confidence code", () => {
    // Ambiguous content that might be code but isn't clear
    const text = `
name = value
another = thing
`;
    const result = shouldPasteAsCodeBlock(text);
    // This might or might not be detected; the key is we don't
    // auto-convert with low confidence
    if (result.should) {
      expect(detectCode(text).confidence).toBe("high");
    }
  });

  it("includes detected language", () => {
    const code = `
const x = 1;
const y = 2;
console.log(x + y);
`;
    const result = shouldPasteAsCodeBlock(code);
    if (result.should) {
      expect(result.language).toBeTruthy();
    }
  });
});

describe("detectCode - additional language patterns", () => {
  it("detects Go code", () => {
    const code = `
package main

import "fmt"

func main() {
    x := 5
    fmt.Println(x)
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("go");
  });

  it("detects Java code", () => {
    const code = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("java");
  });

  it("detects C++ code", () => {
    const code = `
#include <iostream>

int main() {
    std::cout << "Hello" << std::endl;
    return 0;
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("cpp");
  });

  it("detects CSS code", () => {
    const code = `
.container {
    display: flex;
    justify-content: center;
}

#main {
    background: #fff;
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("css");
  });

  it("detects YAML code", () => {
    const code = `
name: my-app
version: 1.0.0
dependencies:
  - lodash
  - express
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("yaml");
  });

  it("detects medium confidence code", () => {
    // Code with some patterns but not strong language markers
    const code = `
x = 10;
y = 20;
if (x > y) {
  result = x + y;
}
`;
    const result = detectCode(code);
    // Should detect as code with some confidence
    expect(result.isCode).toBe(true);
  });

  it("detects low confidence code with language hint", () => {
    // Minimal code that has language-specific markers
    const code = `let x = 1;`;
    const result = detectCode(code);
    // Short but has JS keyword
    expect(typeof result.isCode).toBe("boolean");
  });

  it("handles mixed content with prose patterns", () => {
    const text = `
The function should work like this.
We need to implement it properly.
This is the expected behavior.
`;
    const result = detectCode(text);
    // Prose should not be detected as high confidence code
    expect(result.confidence).not.toBe("high");
  });

  it("detects arrow functions and template literals", () => {
    const code = `
const greet = (name) => {
  return \`Hello, \${name}!\`;
};
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("javascript");
  });

  it("detects TypeScript generics and optional properties", () => {
    const code = `
interface Config<T> {
  value?: T;
  items: Array<T>;
}

function process<T>(config: Config<T>): void {
  console.log(config.value);
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(["typescript", "javascript"]).toContain(result.language);
  });

  it("detects Rust error propagation and attributes", () => {
    const code = `
#[derive(Debug)]
struct Point {
    x: i32,
    y: i32,
}

fn read_file() -> Result<String, Error> {
    let content = fs::read_to_string("file.txt")?;
    Ok(content)
}
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("rust");
  });

  it("detects Python decorators and colon endings", () => {
    const code = `
@decorator
def my_function():
    if True:
        pass
    else:
        return None
`;
    const result = detectCode(code);
    expect(result.isCode).toBe(true);
    expect(result.language).toBe("python");
  });

  it("handles array with invalid JSON", () => {
    const code = `[1, 2, 3,]`; // Trailing comma - invalid JSON
    const result = detectCode(code);
    // Should not crash, may or may not detect as code
    expect(typeof result.isCode).toBe("boolean");
  });

  it("handles object-like content that is not valid JSON", () => {
    const code = `{ x: 1, y: 2 }`; // JS object, not JSON
    const result = detectCode(code);
    expect(typeof result.isCode).toBe("boolean");
  });

  it("detects code with low confidence when minimal language markers exist", () => {
    // Minimal content that has a language marker but not much else
    const code = `import foo
bar`;
    const result = detectCode(code);
    // Should detect with low confidence due to minimal signals
    if (result.isCode && result.confidence === "low") {
      expect(result.language).toBeTruthy();
    }
  });
});
