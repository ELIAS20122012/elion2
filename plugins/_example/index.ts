// Example local plugin. Copy this folder to plugins/<name>/ (no leading "_") and restart Elias OS.
// A plugin can register skills, context sources and providers. It is trusted code: keep it on your PC.
import type { Plugin } from "../../src/plugins/types.ts";

const plugin: Plugin = {
  name: "example",
  version: "0.1.0",
  description: "Example: a /hello skill and a clock context source",
  setup({ kernel, options }) {
    kernel.registerContextSource({
      name: "clock:now",
      capability: "read:clock",
      description: "Current local date and time",
      fetch: async () => new Date().toString(),
    });
    kernel.registerSkill({
      name: "hello",
      description: "سلام و ساعت فعلی",
      plugin: "example",
      build: (input) => ({
        title: "hello",
        prompt: `Greet Elias in Persian${options.style ? ` in a ${String(options.style)} style` : ""} and tell him the time from the DATA. ${input}`,
        capabilities: ["read:clock"],
        context: ["clock:now"],
        verify: { type: "non_empty" },
      }),
    });
  },
};

export default plugin;
