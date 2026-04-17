import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_CONFIG = {
  categories: [
    { id: "pr", emoji: "🚀", label: "PRs & Features" },
    { id: "bugfix", emoji: "🐛", label: "Bug Fixes" },
    { id: "infrastructure", emoji: "🏗️", label: "Infrastructure" },
    { id: "investigation", emoji: "🔍", label: "Investigation" },
    { id: "collaboration", emoji: "🤝", label: "Collaboration" },
    { id: "tooling", emoji: "🔧", label: "Tooling & DX" },
    { id: "oncall", emoji: "🚨", label: "On-Call" },
    { id: "design", emoji: "📐", label: "Design" },
    { id: "documentation", emoji: "📝", label: "Documentation" }
  ],
  output: {
    includeSessionLog: false,
    defaultFormat: "bullets"
  },
  git: {
    enabled: false,
    push: false
  },
  preset: null
};

function cloneDefaultConfig() {
  return {
    categories: DEFAULT_CONFIG.categories.map((category) => ({ ...category })),
    output: { ...DEFAULT_CONFIG.output },
    git: { ...DEFAULT_CONFIG.git },
    preset: DEFAULT_CONFIG.preset
  };
}

function mergeConfig(userConfig = {}) {
  const defaults = cloneDefaultConfig();
  const customCategories = Array.isArray(userConfig.categories)
    ? userConfig.categories.map((category) => ({ ...category }))
    : [];

  const merged = {
    ...defaults,
    ...userConfig,
    categories: [...defaults.categories, ...customCategories],
    output: {
      ...defaults.output,
      ...(userConfig.output || {})
    },
    git: {
      ...defaults.git,
      ...(userConfig.git || {})
    }
  };

  // Microsoft preset: include session log by default
  if (merged.preset === "microsoft") {
    if (!userConfig.output || userConfig.output.includeSessionLog === undefined) {
      merged.output.includeSessionLog = true;
    }
  }

  return merged;
}

export function loadConfig(dataDir) {
  const configPath = join(dataDir, "config.json");

  try {
    if (!existsSync(configPath)) {
      return cloneDefaultConfig();
    }

    const rawConfig = readFileSync(configPath, "utf8");
    const parsedConfig = JSON.parse(rawConfig);
    return mergeConfig(parsedConfig);
  } catch (error) {
    // Config loading failed — fall back silently to defaults
    return cloneDefaultConfig();
  }
}

export function getCategoryById(config, id) {
  return (config?.categories || []).find((category) => category.id === id);
}

export function getCategoryEmoji(config, id) {
  return getCategoryById(config, id)?.emoji || "";
}

export function isValidCategory(config, id) {
  return Boolean(getCategoryById(config, id));
}

export function getAllCategoryIds(config) {
  return (config?.categories || []).map((category) => category.id);
}

/**
 * Build contextual guidance from user config preset.
 * Surfaced to the AI on every prompt so it frames work entries appropriately.
 */
export function buildUserContext(config) {
  if (config?.preset === "microsoft") {
    return [
      "User is a Microsoft employee (preset: microsoft).",
      "Frame work entries for Connect performance reviews.",
      "Use business impact language: 'Did X → Result Y → Evidence Z'.",
      "Emphasize customer/team impact over activity.",
      "The user likely uses Microsoft internal tools:",
      "ADO (Azure DevOps) for PRs/work items/pipelines,",
      "ICM for incident management,",
      "Kusto for telemetry and log analytics,",
      "Teams for collaboration.",
      "When saving brag entries, consider Connect Core Priorities",
      "(customer obsession, impact, teamwork) as framing.",
      "Use 'impact' not 'accomplishment'. Use 'business result' not 'output'.",
    ].join(" ");
  }

  return null;
}
