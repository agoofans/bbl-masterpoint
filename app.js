"use strict";

const state = {
  config: null,
  rankings: null,
  rankingType: "master_points",
  privateData: null,
  routeToken: 0,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function text(element, value) {
  element.textContent = value == null || value === "" ? "—" : String(value);
}

function formatNumber(value) {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(Number(value));
}

function formatPointsGain(value) {
  const formatted = formatNumber(value);
  if (formatted === "—") return formatted;
  return Number(value) > 0 ? `+${formatted}` : formatted;
}

function formatRankSummary(metric) {
  if (!metric || !metric.rank || !metric.total) return "暂无排名";
  const percentage = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(metric.rank_percentage);
  return `第 ${metric.rank} / ${metric.total} · 前 ${percentage}%`;
}

function formatDate(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : String(value);
}

function escapeSearch(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
}

function rankingStyleClasses(item) {
  const title = String(item.title ?? "");
  let suit = "neutral";
  let tier = 0;

  if (title.includes("黑桃")) {
    suit = "spade";
    tier = title.includes("特级") ? 4 : title.includes("高级") ? 3 : title.includes("中级") ? 2 : 1;
  } else if (title.includes("红心")) {
    suit = "heart";
    tier = title.includes("高级") ? 3 : title.includes("中级") ? 2 : 1;
  } else if (title.includes("方块")) {
    suit = "diamond";
    tier = title.includes("三星") ? 3 : title.includes("二星") ? 2 : 1;
  } else if (title.includes("梅花")) {
    suit = "club";
    tier = title.includes("三星") ? 3 : title.includes("二星") ? 2 : 1;
  }

  return [`ranking-row--${suit}`, `ranking-row--tier-${tier}`];
}

function podiumClass(rank) {
  const placement = Number(rank);
  if (placement === 1) return "podium-gold";
  if (placement === 2) return "podium-silver";
  if (placement === 3) return "podium-bronze";
  return "";
}

function b64urlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseAccessCode(value) {
  const code = value.trim();
  const parts = code.split(".");
  if (parts.length !== 4 || parts[0] !== "BRIDGE1") {
    throw new Error("个人链接格式不正确或已被截断。");
  }
  const [, siteId, blobId, key] = parts;
  const safe = /^[A-Za-z0-9_-]+$/;
  if (!safe.test(siteId) || !safe.test(blobId) || !safe.test(key)) {
    throw new Error("访问码包含无效字符。");
  }
  return { siteId, blobId, key };
}

async function decryptRecord(credentials) {
  if (credentials.siteId !== state.config.site_id) {
    throw new Error("此个人链接不适用于当前网站。");
  }
  let response = await fetch(`data/${credentials.blobId}.json`, { cache: "no-store" });
  // Compatibility with repositories whose encrypted JSON files were accidentally
  // uploaded to the repository root instead of the data directory.
  if (!response.ok && response.status === 404) {
    response = await fetch(`${credentials.blobId}.json`, { cache: "no-store" });
  }
  if (!response.ok) {
    throw new Error("找不到对应的个人记录。链接可能已更新，或网站数据尚未更新。");
  }
  const envelope = await response.json();
  if (envelope.algorithm !== "AES-256-GCM" || envelope.version !== 1) {
    throw new Error("个人记录格式不受支持。");
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw", b64urlToBytes(credentials.key), { name: "AES-GCM" }, false, ["decrypt"]
  );
  const additionalData = new TextEncoder().encode(
    `bridge-private-record|v1|${credentials.siteId}|${credentials.blobId}`
  );
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(envelope.nonce), additionalData, tagLength: 128 },
      cryptoKey,
      b64urlToBytes(envelope.ciphertext)
    );
  } catch {
    throw new Error("无法打开个人记录，请确认使用了完整、有效的个人链接。");
  }
  const record = JSON.parse(new TextDecoder().decode(plaintext));
  if (record.format !== "bridge-private-record-v1") {
    throw new Error("个人记录格式无效。");
  }
  return record;
}

function renderRankings() {
  const query = escapeSearch($("#ranking-search").value.trim());
  const items = state.rankings[state.rankingType].filter((item) => {
    return !query || escapeSearch(item.name).includes(query) || escapeSearch(item.member_id).includes(query);
  });
  const body = $("#ranking-body");
  body.replaceChildren();
  for (const item of items) {
    const row = document.createElement("tr");
    row.classList.add(...rankingStyleClasses(item));
    const values = [
      item.rank,
      item.name,
      item.member_id,
      item.title,
      formatNumber(item.master_points),
      formatNumber(item.rating_points),
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      text(cell, value);
      row.append(cell);
    }
    body.append(row);
  }
  $("#ranking-empty").hidden = items.length !== 0;
  const masterHeading = $("#master-heading");
  const ratingHeading = $("#rating-heading");
  masterHeading.classList.toggle("is-sorted", state.rankingType === "master_points");
  ratingHeading.classList.toggle("is-sorted", state.rankingType === "rating_points");
  masterHeading.setAttribute("aria-sort", state.rankingType === "master_points" ? "descending" : "none");
  ratingHeading.setAttribute("aria-sort", state.rankingType === "rating_points" ? "descending" : "none");
}

function addDetail(container, label, value, className = "") {
  const item = document.createElement("div");
  if (className) item.className = className;
  const term = document.createElement("span");
  const description = document.createElement("strong");
  text(term, label);
  text(description, value);
  item.append(term, description);
  container.append(item);
}

function renderRecords() {
  const query = escapeSearch($("#record-search").value.trim());
  const records = state.privateData.participations.filter((record) => {
    const haystack = [record.tournament_name, record.organization, record.category, record.level, record.location]
      .map(escapeSearch).join(" ");
    return !query || haystack.includes(query);
  });
  const container = $("#record-cards");
  container.replaceChildren();
  for (const record of records) {
    const card = document.createElement("article");
    card.className = "record-card";
    const podium = podiumClass(record.rank);
    if (podium) card.classList.add(`record-card--${podium}`);
    const header = document.createElement("div");
    header.className = "record-header";
    const titleWrap = document.createElement("div");
    const date = document.createElement("time");
    date.className = "record-date";
    text(date, formatDate(record.tournament_date));
    const title = document.createElement("h4");
    text(title, record.tournament_name);
    titleWrap.append(date, title);
    const rank = document.createElement("div");
    rank.className = "rank-chip";
    if (podium) rank.classList.add(`rank-chip--${podium}`);
    const rankLabel = document.createElement("span");
    text(rankLabel, "名次 / 参赛规模");
    const rankValue = document.createElement("strong");
    text(rankValue, `${formatNumber(record.rank)} / ${formatNumber(record.total_players)}`);
    rank.append(rankLabel, rankValue);
    header.append(titleWrap, rank);

    const highlights = document.createElement("div");
    highlights.className = "record-highlights";
    addDetail(highlights, "类别", record.category, "record-highlight record-highlight--category");
    addDetail(highlights, "赛事等级", record.level, "record-highlight record-highlight--level");
    addDetail(highlights, "获得大师分", formatPointsGain(record.earned_master_points), "record-highlight record-highlight--score");
    addDetail(highlights, "获得等级分", formatPointsGain(record.earned_rating_points), "record-highlight record-highlight--score");

    const details = document.createElement("div");
    details.className = "record-details";
    addDetail(details, "主办方", record.organization);
    addDetail(details, "地点", record.location);
    addDetail(details, "比赛类型", record.tournament_type);
    addDetail(details, "队伍人数", formatNumber(record.team_size));
    addDetail(details, "赛制长度", formatNumber(record.length));
    card.append(header, highlights, details);
    container.append(card);
  }
  $("#record-empty").hidden = records.length !== 0;
}

function renderLevelUps() {
  const body = $("#level-body");
  body.replaceChildren();
  for (const item of state.privateData.level_ups) {
    const row = document.createElement("tr");
    for (const value of [formatDate(item.tournament_date), item.old_level, item.new_level, item.tournament_name, item.organization]) {
      const cell = document.createElement("td");
      text(cell, value);
      row.append(cell);
    }
    body.append(row);
  }
  $("#level-empty").hidden = state.privateData.level_ups.length !== 0;
}

function renderPrivate(record) {
  state.privateData = record;
  text($("#member-name"), record.member.name);
  text($("#member-title"), record.member.title);
  text($("#member-meta"), `会员号 ${record.member.member_id}`);
  text($("#stat-master"), formatNumber(record.member.master_points));
  text($("#stat-rating"), formatNumber(record.member.rating_points));
  text($("#stat-count"), record.participations.length);
  text($("#stat-master-rank"), formatRankSummary(record.rankings?.master_points));
  text($("#stat-rating-rank"), formatRankSummary(record.rankings?.rating_points));
  text($("#stat-count-rank"), formatRankSummary(record.rankings?.participation_count));
  $("#record-search").value = "";
  renderRecords();
  renderLevelUps();
  $("#private-status").hidden = true;
  $("#private-content").hidden = false;
}

function showPublic() {
  state.routeToken += 1;
  state.privateData = null;
  $("#rankings-panel").hidden = false;
  $("#private-panel").hidden = true;
  $("#private-content").hidden = true;
  $("#record-cards").replaceChildren();
  $("#level-body").replaceChildren();
}

async function showPrivateFromLink(code) {
  const routeToken = ++state.routeToken;
  state.privateData = null;
  $("#rankings-panel").hidden = true;
  $("#private-panel").hidden = false;
  $("#private-content").hidden = true;
  const status = $("#private-status");
  status.hidden = false;
  status.className = "status-message";
  status.textContent = "正在读取个人记录…";
  try {
    const record = await decryptRecord(parseAccessCode(code));
    if (routeToken !== state.routeToken) return;
    renderPrivate(record);
  } catch (error) {
    if (routeToken !== state.routeToken) return;
    status.className = "status-message is-error";
    status.textContent = error.message || "无法打开此个人链接。";
  }
}

function routeFromHash() {
  const code = new URLSearchParams(location.hash.slice(1)).get("p");
  if (code) showPrivateFromLink(code);
  else showPublic();
}

function installEvents() {
  $$(".segment").forEach((button) => button.addEventListener("click", () => {
    state.rankingType = button.dataset.ranking;
    $$(".segment").forEach((item) => item.classList.toggle("is-active", item === button));
    renderRankings();
  }));
  $("#ranking-search").addEventListener("input", renderRankings);
  $("#record-search").addEventListener("input", renderRecords);
  $("#back-to-rankings").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    showPublic();
  });
  window.addEventListener("hashchange", routeFromHash);
}

async function initialize() {
  installEvents();
  try {
    const [configResponse, rankingsResponse] = await Promise.all([
      fetch("site-config.json", { cache: "no-store" }),
      fetch("rankings.json", { cache: "no-store" }),
    ]);
    if (!configResponse.ok || !rankingsResponse.ok) throw new Error("站点数据加载失败");
    state.config = await configResponse.json();
    state.rankings = await rankingsResponse.json();
    document.title = state.config.site_title;
    text($("#site-title"), state.config.site_title);
    text($("#site-subtitle"), state.config.site_subtitle);
    text($("#public-description"), state.config.public_description);
    text($("#footer-text"), state.config.footer_text);
    text($("#updated-at"), `更新于 ${formatDate(state.rankings.generated_at)}`);
    renderRankings();
    routeFromHash();
  } catch (error) {
    $("#ranking-empty").hidden = false;
    $("#ranking-empty").textContent = "网站数据加载失败，请稍后重试。";
    console.error(error);
  }
}

initialize();
