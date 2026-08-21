"use strict";

const state = {
  config: null,
  rankings: null,
  rankingType: "master_points",
  privateData: null,
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

function formatDate(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : String(value);
}

function escapeSearch(value) {
  return String(value ?? "").toLocaleLowerCase("zh-CN");
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
    throw new Error("访问码格式不正确。请粘贴完整访问码，或上传 .key.json 文件。");
  }
  const [, siteId, blobId, key] = parts;
  const safe = /^[A-Za-z0-9_-]+$/;
  if (!safe.test(siteId) || !safe.test(blobId) || !safe.test(key)) {
    throw new Error("访问码包含无效字符。");
  }
  return { siteId, blobId, key };
}

function parseKeyFile(value) {
  if (!value || value.format !== "bridge-private-key-v1") {
    throw new Error("这不是本网站支持的个人密钥文件。");
  }
  return { siteId: value.site_id, blobId: value.blob_id, key: value.key };
}

async function decryptRecord(credentials) {
  if (credentials.siteId !== state.config.site_id) {
    throw new Error("此密钥不属于当前网站。");
  }
  const response = await fetch(`data/${credentials.blobId}.json`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("找不到对应的加密记录。密钥可能已轮换或网站尚未更新。");
  }
  const envelope = await response.json();
  if (envelope.algorithm !== "AES-256-GCM" || envelope.version !== 1) {
    throw new Error("加密数据格式不受支持。");
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
    throw new Error("解密失败：密钥不正确或加密数据已损坏。");
  }
  const record = JSON.parse(new TextDecoder().decode(plaintext));
  if (record.format !== "bridge-private-record-v1") {
    throw new Error("解密后的数据格式无效。");
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
    const values = [item.rank, item.name, item.member_id, item.title, formatNumber(item.score)];
    for (const value of values) {
      const cell = document.createElement("td");
      text(cell, value);
      row.append(cell);
    }
    body.append(row);
  }
  $("#ranking-empty").hidden = items.length !== 0;
  text($("#score-heading"), state.rankingType === "master_points" ? "大师分" : "等级分");
}

function addDetail(container, label, value) {
  const item = document.createElement("div");
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
    rank.append(document.createTextNode("第 "));
    const rankValue = document.createElement("strong");
    text(rankValue, record.rank);
    rank.append(rankValue, document.createTextNode(" 名"));
    header.append(titleWrap, rank);

    const scoreRow = document.createElement("div");
    scoreRow.className = "score-row";
    addDetail(scoreRow, "获得大师分", formatNumber(record.earned_master_points));
    addDetail(scoreRow, "获得等级分", formatNumber(record.earned_rating_points));

    const details = document.createElement("div");
    details.className = "record-details";
    addDetail(details, "类别", record.category);
    addDetail(details, "赛事等级", record.level);
    addDetail(details, "主办方", record.organization);
    addDetail(details, "地点", record.location);
    addDetail(details, "比赛类型", record.tournament_type);
    addDetail(details, "总参赛人数", formatNumber(record.total_players));
    addDetail(details, "队伍人数", formatNumber(record.team_size));
    addDetail(details, "赛制长度", formatNumber(record.length));
    card.append(header, scoreRow, details);
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
  text($("#member-meta"), `会员号 ${record.member.member_id}`);
  text($("#stat-title"), record.member.title);
  text($("#stat-master"), formatNumber(record.member.master_points));
  text($("#stat-rating"), formatNumber(record.member.rating_points));
  text($("#stat-count"), record.participations.length);
  $("#record-search").value = "";
  renderRecords();
  renderLevelUps();
  $("#unlock-card").hidden = true;
  $("#private-content").hidden = false;
  $("#unlock-status").textContent = "";
}

function clearPrivate() {
  state.privateData = null;
  $("#private-content").hidden = true;
  $("#unlock-card").hidden = false;
  $("#access-code").value = "";
  $("#key-file").value = "";
  $("#record-cards").replaceChildren();
  $("#level-body").replaceChildren();
  $("#unlock-status").textContent = "私人数据已从当前页面清除。";
}

async function unlock(credentials) {
  const status = $("#unlock-status");
  status.className = "status-message";
  status.textContent = "正在读取并解密…";
  $("#unlock-button").disabled = true;
  try {
    const record = await decryptRecord(credentials);
    renderPrivate(record);
  } catch (error) {
    status.className = "status-message is-error";
    status.textContent = error.message || "无法解密私人记录。";
  } finally {
    $("#unlock-button").disabled = false;
  }
}

async function handleKeyFile(file) {
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    await unlock(parseKeyFile(value));
  } catch (error) {
    const status = $("#unlock-status");
    status.className = "status-message is-error";
    status.textContent = error.message || "密钥文件无法读取。";
  }
}

function installEvents() {
  $$(".tab").forEach((button) => button.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.toggle("is-active", item === button));
    const selected = button.dataset.tab;
    $("#rankings-panel").hidden = selected !== "rankings";
    $("#private-panel").hidden = selected !== "private";
  }));
  $$(".segment").forEach((button) => button.addEventListener("click", () => {
    state.rankingType = button.dataset.ranking;
    $$(".segment").forEach((item) => item.classList.toggle("is-active", item === button));
    renderRankings();
  }));
  $("#ranking-search").addEventListener("input", renderRankings);
  $("#record-search").addEventListener("input", renderRecords);
  $("#unlock-button").addEventListener("click", () => {
    try { unlock(parseAccessCode($("#access-code").value)); }
    catch (error) {
      $("#unlock-status").className = "status-message is-error";
      $("#unlock-status").textContent = error.message;
    }
  });
  $("#key-file").addEventListener("change", (event) => handleKeyFile(event.target.files[0]));
  $("#clear-private").addEventListener("click", clearPrivate);
  const zone = $("#drop-zone");
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#key-file").click(); }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add("is-dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove("is-dragging"); });
  }
  zone.addEventListener("drop", (event) => handleKeyFile(event.dataTransfer.files[0]));
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
    text($("#private-description"), state.config.private_description);
    text($("#footer-text"), state.config.footer_text);
    text($("#updated-at"), `更新于 ${formatDate(state.rankings.generated_at)}`);
    renderRankings();
  } catch (error) {
    $("#ranking-empty").hidden = false;
    $("#ranking-empty").textContent = "网站数据加载失败，请稍后重试。";
    console.error(error);
  }
}

initialize();
