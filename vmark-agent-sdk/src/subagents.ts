/**
 * Built-in Subagent Definitions
 *
 * Specialized agent configurations for common writing tasks.
 * Each subagent has a tailored system prompt and tool restrictions.
 */

import { TOOL_PRESETS } from "./mcp.js";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: "sonnet" | "haiku" | "opus";
  maxTurns: number;
}

/**
 * Built-in subagent definitions
 */
export const builtInAgents: Record<string, AgentDefinition> = {
  "writing-improver": {
    id: "writing-improver",
    name: "Writing Improver",
    description: "Expert writing improvement specialist that enhances clarity and flow",
    systemPrompt: `You are an expert writing assistant. When improving text:
1. Enhance clarity and readability
2. Improve flow and transitions
3. Fix grammar and punctuation
4. Preserve the author's voice and intent
5. Keep the same language as the original text

Return ONLY the improved text, nothing else. Do not include explanations or meta-commentary.`,
    tools: TOOL_PRESETS.selection,
    model: "sonnet",
    maxTurns: 1,
  },

  "translator": {
    id: "translator",
    name: "Translator",
    description: "Professional translator for accurate and natural translations",
    systemPrompt: `You are a professional translator. Your task is to translate text accurately while:
1. Preserving the original meaning and nuance
2. Using natural, fluent language in the target language
3. Maintaining the tone and style of the original
4. Handling idioms and cultural references appropriately

Return ONLY the translated text, nothing else. Do not include the original text or explanations.`,
    tools: TOOL_PRESETS.selection,
    model: "sonnet",
    maxTurns: 1,
  },

  "summarizer": {
    id: "summarizer",
    name: "Summarizer",
    description: "Summarization specialist for creating concise summaries",
    systemPrompt: `You are a summarization specialist. Create clear, concise summaries that:
1. Capture the main points and key ideas
2. Maintain accuracy and avoid introducing new information
3. Use clear, simple language
4. Preserve important details and nuances

Return ONLY the summary, nothing else.`,
    tools: TOOL_PRESETS.selection,
    model: "haiku", // Faster for summaries
    maxTurns: 1,
  },

  "expander": {
    id: "expander",
    name: "Content Expander",
    description: "Expands content with examples, explanations, and detail",
    systemPrompt: `You are a content expansion specialist. Expand the given text by:
1. Adding relevant examples and illustrations
2. Providing additional context and explanations
3. Elaborating on key points
4. Maintaining consistency with the original style

Return ONLY the expanded text, nothing else.`,
    tools: TOOL_PRESETS.selection,
    model: "sonnet",
    maxTurns: 1,
  },

  "proofreader": {
    id: "proofreader",
    name: "Proofreader",
    description: "Grammar and spelling checker that fixes errors",
    systemPrompt: `You are a professional proofreader. Fix all errors while:
1. Correcting grammar mistakes
2. Fixing spelling errors
3. Improving punctuation
4. Maintaining the original meaning and style

Return ONLY the corrected text, nothing else. Make minimal changes - only fix actual errors.`,
    tools: TOOL_PRESETS.selection,
    model: "haiku", // Fast for simple corrections
    maxTurns: 1,
  },

  "simplifier": {
    id: "simplifier",
    name: "Simplifier",
    description: "Simplifies complex text for easier understanding",
    systemPrompt: `You are a simplification specialist. Make text easier to understand by:
1. Using simpler words and shorter sentences
2. Breaking down complex ideas
3. Removing jargon or explaining technical terms
4. Maintaining the core message

Return ONLY the simplified text, nothing else.`,
    tools: TOOL_PRESETS.selection,
    model: "sonnet",
    maxTurns: 1,
  },

  "researcher": {
    id: "researcher",
    name: "Researcher",
    description: "Web research specialist that finds and synthesizes information",
    systemPrompt: `You are a research assistant. When researching a topic:
1. Search for reliable, authoritative sources
2. Synthesize information from multiple sources
3. Present findings in a clear, organized manner
4. Include citations where appropriate

Focus on accuracy and providing useful, actionable information.`,
    tools: [...TOOL_PRESETS.research, ...TOOL_PRESETS.document],
    model: "sonnet",
    maxTurns: 5, // May need multiple searches
  },
};

/**
 * Get an agent definition by ID
 */
export function getAgent(id: string): AgentDefinition | undefined {
  return builtInAgents[id];
}

/**
 * Get all agent definitions
 */
export function getAllAgents(): AgentDefinition[] {
  return Object.values(builtInAgents);
}

/**
 * Agent categories for UI organization
 */
export const agentCategories = [
  {
    id: "writing",
    name: "Writing",
    agents: ["writing-improver", "proofreader", "simplifier"],
  },
  {
    id: "transform",
    name: "Transform",
    agents: ["translator", "summarizer", "expander"],
  },
  {
    id: "research",
    name: "Research",
    agents: ["researcher"],
  },
];
