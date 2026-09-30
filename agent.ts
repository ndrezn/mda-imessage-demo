import { defineDeepAgent } from "managed-deepagents";

export const agent = defineDeepAgent({
  name: "reflex",
  model: "openai:gpt-5.5",
});
