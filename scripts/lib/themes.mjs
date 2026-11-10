// Themes for FocuSD Island's theme market (TixXin/fly-island C26). A theme is data only:
// themes/<id>.json says what the island looks like (style, font, opacity, glass, corners,
// colours), never its size or layout, and runs no code. build-themes.mjs gathers them into
// themes.json; check-submission.mjs checks one in a pull request. The island checks every value
// again when it reads the index, so these rules keep the index clean, they are not its only guard.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const THEMES_VERSION = 1;
export const THEME_FILE = /^themes\/[^/]+\.json$/;
const ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME = 40;
const MAX_DESCRIPTION = 160;

/** The fields a theme may set, with what each takes (THEME_SETTING_KEYS in the island). */
const FIELDS = {
  appearanceMode: ["classic", "liquidGlass"],
  fontFamily: ["system", "pixel"],
  glassIntensity: [25, 100],
  opacity: [50, 100],
  topFilletRadius: [0, 12],
  islandCornerRadius: [16, 40],
  islandCornerShape: ["squircle", "round"],
  taskTextColor: "color",
  pulseColor: "color",
  pulseBrightness: [50, 160],
  islandBackgroundColor: "color",
};

function text(value, max, label, errors, required = true) {
  if (value === undefined && !required) return;
  if (typeof value !== "object" || value === null) return errors.push(`${label} needs "zh-CN" and "en".`);
  for (const locale of ["zh-CN", "en"]) {
    const item = value[locale];
    if (typeof item !== "string" || !item.trim() || item.length > max) errors.push(`${label}.${locale} must be 1-${max} characters.`);
  }
}

/** What is wrong with a theme submission; empty when nothing is. `fileName` is "<id>.json". */
export function themeErrors(theme, fileName) {
  const errors = [];
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) return ["The file must hold one JSON object."];
  if (typeof theme.id !== "string" || !ID.test(theme.id)) errors.push("id must be 3-64 lower-case letters, digits, dots or hyphens.");
  else if (fileName && fileName !== `${theme.id}.json`) errors.push(`The file must be named ${theme.id}.json.`);
  text(theme.name, MAX_NAME, "name", errors);
  text(theme.description, MAX_DESCRIPTION, "description", errors, false);
  if (typeof theme.author !== "string" || !LOGIN.test(theme.author)) errors.push("author must be a GitHub login.");
  const look = theme.appearance;
  if (typeof look !== "object" || look === null || Array.isArray(look)) {
    errors.push("appearance must be an object.");
    return errors;
  }
  for (const [key, value] of Object.entries(look)) {
    const rule = FIELDS[key];
    if (!rule) errors.push(`appearance.${key} is not a theme field (themes set the look only, not sizes).`);
    else if (rule === "color" && !(typeof value === "string" && HEX.test(value))) errors.push(`appearance.${key} must be a colour like #1a2b3c.`);
    else if (Array.isArray(rule) && typeof rule[0] === "string" && !rule.includes(value)) errors.push(`appearance.${key} must be one of ${rule.join(", ")}.`);
    else if (Array.isArray(rule) && typeof rule[0] === "number" && !(Number.isFinite(value) && value >= rule[0] && value <= rule[1])) errors.push(`appearance.${key} must be a number from ${rule[0]} to ${rule[1]}.`);
  }
  if (Object.keys(look).length === 0) errors.push("appearance sets nothing.");
  return errors;
}

/** Every theme in themes/, read and checked: { themes, errors }. */
export function loadThemes(root) {
  const dir = path.join(root, "themes");
  const themes = [];
  const errors = [];
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { themes, errors };
  }
  for (const name of names) {
    let theme;
    try {
      theme = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      errors.push(`themes/${name}: not valid JSON.`);
      continue;
    }
    const problems = themeErrors(theme, name);
    if (problems.length > 0) errors.push(...problems.map((problem) => `themes/${name}: ${problem}`));
    else themes.push(theme);
  }
  return { themes, errors };
}

/** themes.json: the checked themes, official first, then by id. */
export function buildThemesIndex(themes, official, now) {
  const listed = themes
    .map(({ id, name, description, author, appearance }) => ({ id, name, ...(description ? { description } : {}), author, appearance }))
    .sort((left, right) => Number(right.author === official) - Number(left.author === official) || left.id.localeCompare(right.id));
  return { version: THEMES_VERSION, updatedAt: now, themes: listed };
}
