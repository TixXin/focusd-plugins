// Likes for the plugin market (TixXin/fly-island#16). Every listed plugin has a
// discussion in this repository, in the Announcements category so only
// maintainers and this workflow open them; anyone signed in to GitHub can give it
// a 👍. This script opens the missing discussions, counts the 👍 and writes
// stars.json, which the island reads next to the index. The counts are not
// signed: they are only shown, and the island accepts only links to
// discussions of this repository.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STARS_VERSION = 1;
const OWNER = "TixXin";
const NAME = "focusd-plugins";
const CATEGORY_SLUG = process.env.FOCUSD_STARS_CATEGORY ?? "announcements";
const MARKER = /<!--\s*focusd-plugin:\s*([a-z0-9.-]+)\s*-->/;

/** The plugins the market lists: stable entries, one per id, with their names and repository. */
export function listedPlugins(index) {
  const seen = new Map();
  for (const entry of index.plugins ?? []) {
    if (entry.preRelease || seen.has(entry.id)) continue;
    seen.set(entry.id, { id: entry.id, name: entry.name, repo: entry.repo ?? null });
  }
  return [...seen.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** The plugin a discussion belongs to, from the marker at the top of its body. */
export function pluginOf(body) {
  return MARKER.exec(body ?? "")?.[1] ?? null;
}

/** 👍 on a discussion's post. */
export function thumbsUp(discussion) {
  return discussion.reactionGroups?.find((group) => group.content === "THUMBS_UP")?.reactors?.totalCount ?? 0;
}

/** The discussion opened for a plugin: a title in both languages and the marker this script looks for. */
export function discussionFor(plugin) {
  const zh = plugin.name?.["zh-CN"] ?? plugin.id;
  const en = plugin.name?.en ?? plugin.id;
  const repo = plugin.repo ? `https://github.com/${plugin.repo}` : null;
  const issues = repo ? `\n\n插件的问题请到 [插件仓库](${repo}/issues) 报告。` : "";
  const issuesEn = repo ? ` Report bugs in [the plugin's repository](${repo}/issues).` : "";
  return {
    title: zh === en ? `${zh} (${plugin.id})` : `${zh} / ${en} (${plugin.id})`,
    body: `<!-- focusd-plugin: ${plugin.id} -->
**${zh}** 在 FocuSD Island 插件市场的点赞帖。觉得好用就给这条帖子点 👍，插件市场会显示点赞数（每小时更新一次）。也欢迎在下面留言。${issues}

---

Give this post a 👍 if you like **${en}**: the FocuSD Island plugin market shows the count, updated every hour. Comments are welcome below.${issuesEn}
`,
  };
}

/** stars.json: { version, updatedAt, plugins: { <id>: { count, url } } } for the listed plugins that have a discussion. */
export function buildStars(plugins, discussions, now) {
  const byPlugin = new Map();
  for (const discussion of discussions) {
    const id = pluginOf(discussion.body);
    // The oldest discussion of a plugin wins, so a duplicate does not split its likes.
    if (id && (!byPlugin.has(id) || discussion.number < byPlugin.get(id).number)) byPlugin.set(id, discussion);
  }
  const entries = plugins
    .filter((plugin) => byPlugin.has(plugin.id))
    .map((plugin) => {
      const discussion = byPlugin.get(plugin.id);
      return [plugin.id, { count: thumbsUp(discussion), url: discussion.url }];
    });
  return { version: STARS_VERSION, updatedAt: now, plugins: Object.fromEntries(entries) };
}

/** Whether two stars.json values say the same apart from when they were written. */
export function sameStars(left, right) {
  return JSON.stringify(left?.plugins ?? null) === JSON.stringify(right?.plugins ?? null) && left?.version === right?.version;
}

async function graphql(query, variables) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is needed to read and open discussions.");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "focusd-plugins-stars" },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors) throw new Error(`GitHub GraphQL: ${JSON.stringify(result.errors ?? result)}`);
  return result.data;
}

async function readDiscussions() {
  const repo = (await graphql(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id hasDiscussionsEnabled discussionCategories(first: 25) { nodes { id slug } } } }`,
    { owner: OWNER, name: NAME },
  )).repository;
  if (!repo.hasDiscussionsEnabled) throw new Error(`Discussions are off in ${OWNER}/${NAME}.`);
  const category = repo.discussionCategories.nodes.find((node) => node.slug === CATEGORY_SLUG);
  if (!category) throw new Error(`${OWNER}/${NAME} has no discussion category "${CATEGORY_SLUG}".`);
  const discussions = [];
  let after = null;
  do {
    const page = (await graphql(
      `query($owner: String!, $name: String!, $category: ID!, $after: String) { repository(owner: $owner, name: $name) {
        discussions(first: 100, after: $after, categoryId: $category) { pageInfo { hasNextPage endCursor }
          nodes { number url body reactionGroups { content reactors { totalCount } } } } } }`,
      { owner: OWNER, name: NAME, category: category.id, after },
    )).repository.discussions;
    discussions.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { repositoryId: repo.id, categoryId: category.id, discussions };
}

async function openDiscussion(repositoryId, categoryId, plugin) {
  const { title, body } = discussionFor(plugin);
  const created = (await graphql(
    `mutation($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { number url body reactionGroups { content reactors { totalCount } } } } }`,
    { input: { repositoryId, categoryId, title, body } },
  )).createDiscussion.discussion;
  console.log(`Opened discussion #${created.number} for ${plugin.id}.`);
  return created;
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const plugins = listedPlugins(JSON.parse(readFileSync(`${root}index.json`, "utf8")));
  const { repositoryId, categoryId, discussions } = await readDiscussions();
  const covered = new Set(discussions.map((discussion) => pluginOf(discussion.body)));
  for (const plugin of plugins.filter((plugin) => !covered.has(plugin.id))) {
    discussions.push(await openDiscussion(repositoryId, categoryId, plugin));
  }
  const path = `${root}stars.json`;
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const next = buildStars(plugins, discussions, new Date().toISOString());
  if (sameStars(previous, next)) {
    console.log("The likes did not change.");
    return;
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote stars.json for ${Object.keys(next.plugins).length} plugins.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
