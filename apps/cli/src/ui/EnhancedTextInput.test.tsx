import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render } from "ink-testing-library";
import { EnhancedTextInput } from "./EnhancedTextInput.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("EnhancedTextInput component", () => {
  it("renders placeholder when value is empty", () => {
    const { lastFrame } = render(
      <EnhancedTextInput
        value=""
        placeholder="Enter your command..."
        onChange={() => {}}
      />
    );
    expect(lastFrame()).toContain("Enter your command...");
  });

  it("handles standard typing", async () => {
    let currentVal = "";
    const Wrapper = () => {
      const [val, setVal] = useState("");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    stdin.write("hello");
    await delay(30);

    expect(currentVal).toBe("hello");
    unmount();
  });

  it("handles Ctrl+Backspace to delete word backward", async () => {
    let currentVal = "git commit -m";
    const Wrapper = () => {
      const [val, setVal] = useState("git commit -m");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // \x17 is standard Ctrl+W / Ctrl+Backspace
    stdin.write("\x17");
    await delay(30);

    expect(currentVal).toBe("git commit -");
    unmount();
  });

  it("handles Ctrl+Delete to delete word forward", async () => {
    let currentVal = "git commit";
    const Wrapper = () => {
      const [val, setVal] = useState("git commit");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Home key to jump to start: \x1b[H
    stdin.write("\x1b[H");
    await delay(20);
    // Ctrl+Delete sequence: \x1b[3;5~
    stdin.write("\x1b[3;5~");
    await delay(30);

    expect(currentVal).toBe(" commit");
    unmount();
  });

  it("handles Ctrl+A (select all) and clears on Backspace", async () => {
    let currentVal = "initial text";
    const Wrapper = () => {
      const [val, setVal] = useState("initial text");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Ctrl+A is \x01
    stdin.write("\x01");
    await delay(20);
    // Backspace: \x7f
    stdin.write("\x7f");
    await delay(30);

    expect(currentVal).toBe("");
    unmount();
  });

  it("handles Ctrl+A (select all) and replaces with newly typed character", async () => {
    let currentVal = "initial text";
    const Wrapper = () => {
      const [val, setVal] = useState("initial text");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Ctrl+A
    stdin.write("\x01");
    await delay(20);
    // Type 'A'
    stdin.write("A");
    await delay(30);

    expect(currentVal).toBe("A");
    unmount();
  });

  it("handles forward Delete key", async () => {
    let currentVal = "hello";
    const Wrapper = () => {
      const [val, setVal] = useState("hello");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Home key: \x1b[H
    stdin.write("\x1b[H");
    await delay(20);
    // Forward delete: \x1b[3~
    stdin.write("\x1b[3~");
    await delay(30);

    expect(currentVal).toBe("ello");
    unmount();
  });

  it("handles Ctrl+U (kill line to start)", async () => {
    let currentVal = "some long command";
    const Wrapper = () => {
      const [val, setVal] = useState("some long command");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Ctrl+U: \x15
    stdin.write("\x15");
    await delay(30);

    expect(currentVal).toBe("");
    unmount();
  });

  it("handles Ctrl+K (kill line to end)", async () => {
    let currentVal = "npm run test:all";
    const Wrapper = () => {
      const [val, setVal] = useState("npm run test:all");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Move home
    stdin.write("\x1b[H");
    await delay(20);
    // Move forward 1 word (Ctrl+Right: \x1b[1;5C) -> after "npm"
    stdin.write("\x1b[1;5C");
    await delay(20);
    // Ctrl+K: \x0b
    stdin.write("\x0b");
    await delay(30);

    expect(currentVal).toBe("npm");
    unmount();
  });

  it("handles Ctrl+Left and Ctrl+Right word navigation", async () => {
    let currentVal = "first second third";
    const Wrapper = () => {
      const [val, setVal] = useState("first second third");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Cursor starts at end (after "third"). Move back 1 word (Ctrl+Left: \x1b[1;5D) -> before "third"
    stdin.write("\x1b[1;5D");
    await delay(20);
    // Insert text: "middle "
    stdin.write("middle ");
    await delay(30);

    expect(currentVal).toBe("first second middle third");
    unmount();
  });

  it("handles Home and End keys for jumping to line boundaries", async () => {
    let currentVal = "hello world";
    const Wrapper = () => {
      const [val, setVal] = useState("hello world");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Home key: \x1b[H
    stdin.write("\x1b[H");
    await delay(20);
    stdin.write("say ");
    await delay(30);
    expect(currentVal).toBe("say hello world");

    // End key: \x1b[F
    stdin.write("\x1b[F");
    await delay(20);
    stdin.write(" today");
    await delay(30);
    expect(currentVal).toBe("say hello world today");
    unmount();
  });

  it("handles Ctrl+A toggle and Escape unselecting", async () => {
    let currentVal = "select me";
    const Wrapper = () => {
      const [val, setVal] = useState("select me");
      return (
        <EnhancedTextInput
          value={val}
          onChange={(v) => {
            setVal(v);
            currentVal = v;
          }}
        />
      );
    };

    const { stdin, unmount } = render(<Wrapper />);
    await delay(20);
    // Ctrl+A to select all
    stdin.write("\x01");
    await delay(20);
    // Escape to cancel selection
    stdin.write("\x1b");
    await delay(20);
    // Typing should now insert rather than replace
    stdin.write("!");
    await delay(30);

    expect(currentVal).toContain("select me");
    unmount();
  });

  it("handles Enter to submit", async () => {
    let submittedVal = "";
    const { stdin, unmount } = render(
      <EnhancedTextInput
        value="my-task"
        onChange={() => {}}
        onSubmit={(v) => {
          submittedVal = v;
        }}
      />
    );
    await delay(20);
    stdin.write("\r");
    await delay(30);

    expect(submittedVal).toBe("my-task");
    unmount();
  });
});
