#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_yargs = __toESM(require("yargs"));
var import_helpers = require("yargs/helpers");

// src/api.ts
var import_node_fetch = __toESM(require("node-fetch"));
var PostizAPI = class {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || "https://studio.voholabs.com/api";
  }
  async request(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const headers = __spreadValues({
      "Content-Type": "application/json",
      Authorization: this.apiKey
    }, options.headers);
    try {
      const response = await (0, import_node_fetch.default)(url, __spreadProps(__spreadValues({}, options), {
        headers
      }));
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error (${response.status}): ${error}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Request failed: ${error.message}`);
    }
  }
  async createPost(data) {
    return this.request("/public/v1/posts", {
      method: "POST",
      body: JSON.stringify(data)
    });
  }
  async listPosts(filters = {}) {
    const queryString = new URLSearchParams(
      Object.entries(filters).reduce((acc, [key, value]) => {
        if (value !== void 0 && value !== null) {
          acc[key] = String(value);
        }
        return acc;
      }, {})
    ).toString();
    const endpoint = queryString ? `/public/v1/posts?${queryString}` : "/public/v1/posts";
    return this.request(endpoint, {
      method: "GET"
    });
  }
  async deletePost(id) {
    return this.request(`/public/v1/posts/${id}`, {
      method: "DELETE"
    });
  }
  async upload(file, filename) {
    var _a;
    const formData = new import_node_fetch.FormData();
    const extension = ((_a = filename.split(".").pop()) == null ? void 0 : _a.toLowerCase()) || "";
    const mimeTypes = {
      // Images
      "png": "image/png",
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "gif": "image/gif",
      "webp": "image/webp",
      "svg": "image/svg+xml",
      "bmp": "image/bmp",
      "ico": "image/x-icon",
      // Videos
      "mp4": "video/mp4",
      "mov": "video/quicktime",
      "avi": "video/x-msvideo",
      "mkv": "video/x-matroska",
      "webm": "video/webm",
      "flv": "video/x-flv",
      "wmv": "video/x-ms-wmv",
      "m4v": "video/x-m4v",
      "mpeg": "video/mpeg",
      "mpg": "video/mpeg",
      "3gp": "video/3gpp",
      // Audio
      "mp3": "audio/mpeg",
      "wav": "audio/wav",
      "ogg": "audio/ogg",
      "aac": "audio/aac",
      "flac": "audio/flac",
      "m4a": "audio/mp4",
      // Documents
      "pdf": "application/pdf",
      "doc": "application/msword",
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
    const type = mimeTypes[extension] || "application/octet-stream";
    const blob = new Blob([file], { type });
    formData.append("file", blob, filename);
    const url = `${this.apiUrl}/public/v1/upload`;
    const response = await (0, import_node_fetch.default)(url, {
      method: "POST",
      // @ts-ignore
      body: formData,
      headers: {
        Authorization: this.apiKey
      }
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed (${response.status}): ${error}`);
    }
    return await response.json();
  }
  async getMissingContent(postId) {
    return this.request(`/public/v1/posts/${postId}/missing`, {
      method: "GET"
    });
  }
  async updateReleaseId(postId, releaseId) {
    return this.request(`/public/v1/posts/${postId}/release-id`, {
      method: "PUT",
      body: JSON.stringify({ releaseId })
    });
  }
  async changePostStatus(postId, status) {
    return this.request(`/public/v1/posts/${postId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
  }
  async getAnalytics(integrationId, date) {
    return this.request(`/public/v1/analytics/${integrationId}?date=${encodeURIComponent(date)}`, {
      method: "GET"
    });
  }
  async getPostAnalytics(postId, date) {
    return this.request(`/public/v1/analytics/post/${postId}?date=${encodeURIComponent(date)}`, {
      method: "GET"
    });
  }
  async listIntegrations(group) {
    const query = group ? `?group=${encodeURIComponent(group)}` : "";
    return this.request(`/public/v1/integrations${query}`, {
      method: "GET"
    });
  }
  async listGroups() {
    return this.request("/public/v1/groups", {
      method: "GET"
    });
  }
  async getIntegrationSettings(integrationId) {
    return this.request(`/public/v1/integration-settings/${integrationId}`, {
      method: "GET"
    });
  }
  async triggerIntegrationTool(integrationId, methodName, data) {
    return this.request(`/public/v1/integration-trigger/${integrationId}`, {
      method: "POST",
      body: JSON.stringify({ methodName, data })
    });
  }
  async getBrainSchema() {
    return this.request("/public/v1/brain/schema", {
      method: "GET"
    });
  }
  async getBrain() {
    return this.request("/public/v1/brain", {
      method: "GET"
    });
  }
  async getBrainDocument(category, key) {
    return this.request(
      `/public/v1/brain/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
      {
        method: "GET"
      }
    );
  }
  async saveBrainDocument(category, key, body) {
    return this.request(
      `/public/v1/brain/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body)
      }
    );
  }
  async deleteBrainDocument(category, key) {
    return this.request(
      `/public/v1/brain/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
      {
        method: "DELETE"
      }
    );
  }
};

// src/commands/auth.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var import_node_fetch2 = __toESM(require("node-fetch"));
var CREDENTIALS_DIR = (0, import_path.join)((0, import_os.homedir)(), ".voholabs");
var CREDENTIALS_FILE = (0, import_path.join)(CREDENTIALS_DIR, "credentials.json");
var DEFAULT_AUTH_SERVER = "https://studio.voholabs.com/api";
function loadCredentials() {
  try {
    if (!(0, import_fs.existsSync)(CREDENTIALS_FILE)) return null;
    const data = JSON.parse((0, import_fs.readFileSync)(CREDENTIALS_FILE, "utf-8"));
    if (!data.accessToken) return null;
    return data;
  } catch (e) {
    return null;
  }
}
function saveCredentials(credentials) {
  if (!(0, import_fs.existsSync)(CREDENTIALS_DIR)) {
    (0, import_fs.mkdirSync)(CREDENTIALS_DIR, { recursive: true, mode: 448 });
  }
  (0, import_fs.writeFileSync)(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { encoding: "utf-8", mode: 384 });
  (0, import_fs.chmodSync)(CREDENTIALS_FILE, 384);
}
function deleteCredentials() {
  if ((0, import_fs.existsSync)(CREDENTIALS_FILE)) {
    (0, import_fs.unlinkSync)(CREDENTIALS_FILE);
  }
}
function openBrowser(url) {
  const { exec } = require("child_process");
  const platform = process.platform;
  if (platform === "darwin") {
    exec(`open "${url}"`);
  } else if (platform === "win32") {
    exec(`start "" "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function authLogin(argv) {
  const authServer = argv.authServer || process.env.VOHOLABS_AUTH_SERVER || DEFAULT_AUTH_SERVER;
  console.log("\u{1F510} Starting device authorization flow...\n");
  let deviceCode;
  let userCode;
  let verificationUri;
  let expiresIn;
  let interval;
  try {
    const response = await (0, import_node_fetch2.default)(`${authServer}/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!response.ok) {
      const error = await response.text();
      console.error(`\u274C Failed to start authorization (${response.status}): ${error}`);
      process.exit(1);
    }
    const data = await response.json();
    deviceCode = data.device_code;
    userCode = data.user_code;
    verificationUri = data.verification_uri;
    expiresIn = data.expires_in;
    interval = data.interval || 5;
  } catch (error) {
    console.error(`\u274C Could not reach auth server at ${authServer}: ${error.message}`);
    process.exit(1);
  }
  console.log("  Your authorization code:\n");
  console.log(`    \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);
  console.log(`    \u2502    ${userCode}    \u2502`);
  console.log(`    \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518
`);
  console.log(`  Open this URL and enter the code above:`);
  console.log(`  ${verificationUri}
`);
  openBrowser(`${verificationUri}?code=${encodeURIComponent(userCode)}`);
  console.log("  Waiting for authorization...\n");
  const deadline = Date.now() + expiresIn * 1e3;
  while (Date.now() < deadline) {
    await sleep(interval * 1e3);
    try {
      const response = await (0, import_node_fetch2.default)(`${authServer}/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode })
      });
      const data = await response.json();
      if (response.ok && data.access_token) {
        saveCredentials({
          accessToken: data.access_token,
          apiUrl: data.api_url || "https://studio.voholabs.com/api",
          organizationId: data.organization_id
        });
        console.log("\u2705 Successfully authenticated!");
        console.log(`\u{1F4C1} Credentials saved to ${CREDENTIALS_FILE}`);
        if (data.organization_id) {
          console.log(`\u{1F3E2} Organization ID: ${data.organization_id}`);
        }
        return;
      }
      if (data.error === "authorization_pending") {
        continue;
      }
      if (data.error === "expired_token") {
        console.error("\u274C Authorization expired. Please try again.");
        process.exit(1);
      }
      console.error(`\u274C Authorization failed: ${data.error}`);
      process.exit(1);
    } catch (e) {
      continue;
    }
  }
  console.error("\u274C Authorization timed out. Please try again.");
  process.exit(1);
}
async function authLogout() {
  const creds = loadCredentials();
  if (!creds) {
    console.log("\u2139\uFE0F  No stored credentials found.");
    return;
  }
  deleteCredentials();
  console.log("\u2705 Credentials removed.");
}
async function authStatus() {
  const envKey = process.env.VOHOLABS_API_KEY;
  const creds = loadCredentials();
  let apiKey;
  let apiUrl;
  if (creds) {
    console.log("\u{1F510} Authentication method: OAuth2");
    console.log(`\u{1F4E1} API URL: ${creds.apiUrl}`);
    console.log(`\u{1F511} Token: ${creds.accessToken.substring(0, 8)}...`);
    if (creds.organizationId) {
      console.log(`\u{1F3E2} Organization: ${creds.organizationId}`);
    }
    console.log(`\u{1F4C1} Credentials file: ${CREDENTIALS_FILE}`);
    apiKey = creds.accessToken;
    apiUrl = creds.apiUrl;
  } else if (envKey) {
    console.log("\u{1F511} Authentication method: API Key (environment variable)");
    console.log(`\u{1F511} Key: ${envKey.substring(0, 8)}...`);
    apiKey = envKey;
    apiUrl = process.env.VOHOLABS_API_URL || "https://studio.voholabs.com/api";
  } else {
    console.log("\u274C Not authenticated.");
    console.log("\nOptions:");
    console.log("  1. OAuth2: voholabs auth:login");
    console.log("  2. API Key: export VOHOLABS_API_KEY=your_api_key");
    return;
  }
  console.log("\n\u{1F504} Verifying credentials...");
  try {
    const response = await (0, import_node_fetch2.default)(`${apiUrl}/public/v1/integrations`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey
      }
    });
    if (response.ok) {
      const integrations = await response.json();
      console.log(`\u2705 Credentials are valid. ${integrations.length} integration(s) connected.`);
    } else if (response.status === 401 || response.status === 403) {
      console.log("\u274C Credentials are expired or invalid. Please re-authenticate.");
      if (creds) {
        console.log("   Run: voholabs auth:login");
      } else {
        console.log("   Update your VOHOLABS_API_KEY environment variable.");
      }
    } else {
      const error = await response.text();
      console.log(`\u26A0\uFE0F  Could not verify credentials (HTTP ${response.status}): ${error}`);
    }
  } catch (error) {
    console.log(`\u26A0\uFE0F  Could not reach API to verify credentials: ${error.message}`);
  }
}

// src/config.ts
function getConfig() {
  const creds = loadCredentials();
  if (creds) {
    return {
      apiKey: creds.accessToken,
      apiUrl: creds.apiUrl
    };
  }
  const apiKey = process.env.VOHOLABS_API_KEY;
  const apiUrl = process.env.VOHOLABS_API_URL;
  if (!apiKey) {
    console.error("\u274C Error: No authentication found.");
    console.error("Options:");
    console.error("  1. OAuth2: voholabs auth:login --client-id <id> --client-secret <secret>");
    console.error("  2. API Key: export VOHOLABS_API_KEY=your_api_key");
    process.exit(1);
  }
  return {
    apiKey,
    apiUrl
  };
}

// src/commands/posts.ts
var import_fs2 = require("fs");
async function getMissingContent(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Post ID is required");
    process.exit(1);
  }
  try {
    const result = await api.getMissingContent(args.id);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to get missing content:", error.message);
    process.exit(1);
  }
}
async function connectPost(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Post ID is required");
    process.exit(1);
  }
  if (!args.releaseId) {
    console.error("\u274C --release-id is required");
    process.exit(1);
  }
  try {
    const result = await api.updateReleaseId(args.id, args.releaseId);
    console.log(`\u2705 Post ${args.id} connected to release ${args.releaseId}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to connect post:", error.message);
    process.exit(1);
  }
}
async function createPost(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  let postData;
  if (args.json) {
    try {
      const jsonPath = args.json;
      if (!(0, import_fs2.existsSync)(jsonPath)) {
        console.error(`\u274C JSON file not found: ${jsonPath}`);
        process.exit(1);
      }
      const jsonContent = (0, import_fs2.readFileSync)(jsonPath, "utf-8");
      postData = JSON.parse(jsonContent);
    } catch (error) {
      console.error("\u274C Failed to parse JSON file:", error.message);
      process.exit(1);
    }
  } else {
    const integrations = args.integrations ? args.integrations.split(",").map((id) => id.trim()) : [];
    if (integrations.length === 0) {
      console.error("\u274C At least one integration ID is required");
      console.error("Use -i or --integrations to specify integration IDs");
      console.error('Run "postiz integrations:list" to see available integrations');
      process.exit(1);
    }
    const contents = Array.isArray(args.content) ? args.content : [args.content];
    const medias = Array.isArray(args.media) ? args.media : args.media ? [args.media] : [];
    if (!contents[0]) {
      console.error("\u274C At least one -c/--content is required");
      process.exit(1);
    }
    const values = contents.map((content, index) => {
      const mediaForThisContent = medias[index];
      const images = mediaForThisContent ? mediaForThisContent.split(",").map((img) => ({
        id: Math.random().toString(36).substring(7),
        path: img.trim()
      })) : [];
      return {
        content,
        image: images,
        delay: (args == null ? void 0 : args.delay) || 0
      };
    });
    let settings = void 0;
    if (args.settings) {
      try {
        settings = typeof args.settings === "string" ? JSON.parse(args.settings) : args.settings;
      } catch (error) {
        console.error("\u274C Failed to parse settings JSON:", error.message);
        process.exit(1);
      }
    }
    postData = {
      type: args.type || "schedule",
      // 'schedule' or 'draft'
      creationMethod: "CLI",
      date: args.date,
      // Required date field
      shortLink: args.shortLink !== false,
      tags: [],
      posts: integrations.map((integrationId) => ({
        integration: { id: integrationId },
        value: values,
        settings
      }))
    };
  }
  try {
    const result = await api.createPost(postData);
    console.log("\u2705 Post created successfully!");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to create post:", error.message);
    process.exit(1);
  }
}
async function listPosts(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  const defaultStartDate = /* @__PURE__ */ new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  const defaultEndDate = /* @__PURE__ */ new Date();
  defaultEndDate.setDate(defaultEndDate.getDate() + 30);
  const filters = {
    startDate: args.startDate || defaultStartDate.toISOString(),
    endDate: args.endDate || defaultEndDate.toISOString()
  };
  if (args.customer) {
    filters.customer = args.customer;
  }
  try {
    const result = await api.listPosts(filters);
    console.log("\u{1F4CB} Posts:");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to list posts:", error.message);
    process.exit(1);
  }
}
async function changePostStatus(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Post ID is required");
    process.exit(1);
  }
  if (args.status !== "draft" && args.status !== "schedule") {
    console.error('\u274C --status must be either "draft" or "schedule"');
    process.exit(1);
  }
  try {
    const result = await api.changePostStatus(args.id, args.status);
    console.log(`\u2705 Post ${args.id} status changed to ${args.status}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to change post status:", error.message);
    process.exit(1);
  }
}
async function deletePost(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Post ID is required");
    process.exit(1);
  }
  try {
    await api.deletePost(args.id);
    console.log(`\u2705 Post ${args.id} deleted successfully!`);
  } catch (error) {
    console.error("\u274C Failed to delete post:", error.message);
    process.exit(1);
  }
}

// src/commands/integrations.ts
async function listIntegrations(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  try {
    const result = await api.listIntegrations(args == null ? void 0 : args.group);
    console.log("\u{1F50C} Connected Integrations:");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to list integrations:", error.message);
    process.exit(1);
  }
}
async function listGroups() {
  const config = getConfig();
  const api = new PostizAPI(config);
  try {
    const result = await api.listGroups();
    console.log("\u{1F465} Groups (Customers):");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to list groups:", error.message);
    process.exit(1);
  }
}
async function getIntegrationSettings(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Integration ID is required");
    process.exit(1);
  }
  try {
    const result = await api.getIntegrationSettings(args.id);
    console.log(`\u2699\uFE0F  Settings for integration: ${args.id}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to get integration settings:", error.message);
    process.exit(1);
  }
}
async function triggerIntegrationTool(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Integration ID is required");
    process.exit(1);
  }
  if (!args.method) {
    console.error("\u274C Method name is required");
    process.exit(1);
  }
  let data = {};
  if (args.data) {
    try {
      data = JSON.parse(args.data);
    } catch (error) {
      console.error("\u274C Failed to parse data JSON:", error.message);
      process.exit(1);
    }
  }
  try {
    const result = await api.triggerIntegrationTool(args.id, args.method, data);
    console.log(`\u{1F527} Tool result for ${args.method}:`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to trigger tool:", error.message);
    process.exit(1);
  }
}

// src/commands/analytics.ts
async function getAnalytics(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Integration ID is required");
    process.exit(1);
  }
  const date = args.date || "7";
  try {
    const result = await api.getAnalytics(args.id, date);
    console.log(`\u{1F4CA} Analytics for integration: ${args.id}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to get analytics:", error.message);
    process.exit(1);
  }
}
async function getPostAnalytics(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.id) {
    console.error("\u274C Post ID is required");
    process.exit(1);
  }
  const date = args.date || "7";
  try {
    const result = await api.getPostAnalytics(args.id, date);
    console.log(`\u{1F4CA} Analytics for post: ${args.id}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to get post analytics:", error.message);
    process.exit(1);
  }
}

// src/commands/upload.ts
var import_fs3 = require("fs");
async function uploadFile(args) {
  const config = getConfig();
  const api = new PostizAPI(config);
  if (!args.file) {
    console.error("\u274C File path is required");
    process.exit(1);
  }
  try {
    const fileBuffer = (0, import_fs3.readFileSync)(args.file);
    const filename = args.file.split("/").pop() || "file";
    const result = await api.upload(fileBuffer, filename);
    console.log("\u2705 File uploaded successfully!");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to upload file:", error.message);
    process.exit(1);
  }
}

// src/commands/brain.ts
var import_readline = require("readline");
var import_fs4 = require("fs");
var ruleId = () => Math.random().toString(36).slice(2, 12);
async function confirmHuman(summary) {
  console.log("");
  console.log(summary);
  console.log("");
  if (!process.stdin.isTTY) {
    console.error("\u274C This changes the agent brain and needs a human to approve it.");
    console.error("   Run it in a terminal; it will not auto-approve.");
    process.exit(1);
  }
  const rl = (0, import_readline.createInterface)({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question("Type 'yes' to apply this change: ", (a) => {
      rl.close();
      resolve(String(a || "").trim().toLowerCase());
    });
  });
  if (answer !== "yes") {
    console.log("\u26A0\uFE0F  Cancelled, nothing was changed.");
    process.exit(0);
  }
}
async function brainSchema() {
  const api = new PostizAPI(getConfig());
  try {
    const result = await api.getBrainSchema();
    console.log("\u{1F9E0} Brain structure:");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to read the brain schema:", error.message);
    process.exit(1);
  }
}
async function brainList(args) {
  const api = new PostizAPI(getConfig());
  try {
    const result = await api.getBrain();
    const documents = (args == null ? void 0 : args.category) ? result.documents.filter((d) => d.category === args.category) : result.documents;
    console.log("\u{1F9E0} Agent brain:");
    console.log(JSON.stringify(__spreadProps(__spreadValues({}, result), { documents }), null, 2));
    return documents;
  } catch (error) {
    console.error("\u274C Failed to read the brain:", error.message);
    process.exit(1);
  }
}
async function brainGet(args) {
  const api = new PostizAPI(getConfig());
  try {
    const result = await api.getBrainDocument(args.category, args.key);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to read the document:", error.message);
    process.exit(1);
  }
}
async function brainSet(args) {
  const api = new PostizAPI(getConfig());
  let payload;
  try {
    const raw = args.file ? (0, import_fs4.readFileSync)(args.file, "utf8") : args.rules;
    if (!raw) {
      console.error("\u274C Pass --file <path> or --rules '<json>'");
      process.exit(1);
    }
    payload = JSON.parse(raw);
  } catch (error) {
    console.error("\u274C Could not read the rules:", error.message);
    process.exit(1);
  }
  const rules = Array.isArray(payload) ? payload : payload.rules || [];
  const body = {
    blocks: rules.map((rule) => ({
      id: ruleId(),
      heading: String(rule.heading || ""),
      body: String(rule.body || "")
    }))
  };
  if (payload.title !== void 0) {
    body.title = String(payload.title);
  }
  if (payload.links) {
    body.links = payload.links.map((link) => ({
      id: ruleId(),
      url: String(link.url || ""),
      note: String(link.note || "")
    }));
  }
  if (payload.assets) {
    body.assets = payload.assets.map((asset) => __spreadProps(__spreadValues({
      id: ruleId(),
      name: String(asset.name || ""),
      url: String(asset.url || "")
    }, asset.mime ? { mime: String(asset.mime) } : {}), {
      note: String(asset.note || "")
    }));
  }
  const blocks = body.blocks;
  const preview = blocks.map((b) => `  \u2022 ${b.heading || "(no heading)"}
    ${b.body.replace(/\n/g, "\n    ")}`).join("\n");
  const attachments = [
    body.links ? `${body.links.length} link(s)` : "",
    body.assets ? `${body.assets.length} file(s)` : ""
  ].filter(Boolean).join(" and ");
  await confirmHuman(
    `About to REPLACE ${args.category}/${args.key} with ${blocks.length} rule(s)${attachments ? `, ${attachments}` : ""}.
Anything currently in this document and not listed below will be lost.
${body.links ? "" : "Links are left as they are.\n"}${body.assets ? "" : "Files are left as they are.\n"}
${preview || "  (no rules \u2014 this empties the document)"}`
  );
  try {
    const result = await api.saveBrainDocument(args.category, args.key, body);
    console.log("\u2705 Saved");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("\u274C Failed to save:", error.message);
    process.exit(1);
  }
}
async function brainDelete(args) {
  var _a;
  const api = new PostizAPI(getConfig());
  let existing;
  try {
    existing = await api.getBrainDocument(args.category, args.key);
  } catch (error) {
    console.error("\u274C Could not find that document:", error.message);
    process.exit(1);
  }
  const count = (((_a = existing == null ? void 0 : existing.content) == null ? void 0 : _a.blocks) || []).length;
  await confirmHuman(
    `About to DELETE ${args.category}/${args.key} and its ${count} rule(s). This cannot be undone.`
  );
  try {
    await api.deleteBrainDocument(args.category, args.key);
    console.log("\u2705 Deleted");
  } catch (error) {
    console.error("\u274C Failed to delete:", error.message);
    process.exit(1);
  }
}

// src/index.ts
(0, import_yargs.default)((0, import_helpers.hideBin)(process.argv)).scriptName("voholabs").usage("$0 <command> [options]").command(
  "posts:create",
  "Create a new post",
  (yargs2) => {
    return yargs2.option("content", {
      alias: "c",
      describe: "Post/comment content (can be used multiple times)",
      type: "string"
    }).option("media", {
      alias: "m",
      describe: "Comma-separated media URLs for the corresponding -c (can be used multiple times)",
      type: "string"
    }).option("integrations", {
      alias: "i",
      describe: "Comma-separated list of integration IDs",
      type: "string"
    }).option("date", {
      alias: "s",
      describe: "Schedule date (ISO 8601 format) - REQUIRED",
      type: "string"
    }).option("type", {
      alias: "t",
      describe: 'Post type: "schedule" or "draft"',
      type: "string",
      choices: ["schedule", "draft"],
      default: "schedule"
    }).option("delay", {
      alias: "d",
      describe: "Delay in minutes between comments (default: 0)",
      type: "number",
      default: 0
    }).option("json", {
      alias: "j",
      describe: "Path to JSON file with full post structure",
      type: "string"
    }).option("shortLink", {
      describe: "Use short links",
      type: "boolean",
      default: true
    }).option("settings", {
      describe: "Platform-specific settings as JSON string",
      type: "string"
    }).check((argv) => {
      if (!argv.json && !argv.content) {
        throw new Error("Either --content or --json is required");
      }
      if (!argv.json && !argv.integrations) {
        throw new Error("--integrations is required when not using --json");
      }
      if (!argv.json && !argv.date) {
        throw new Error("--date is required when not using --json");
      }
      return true;
    }).example(
      '$0 posts:create -c "Hello World!" -s "2024-12-31T12:00:00Z" -i "twitter-123"',
      "Simple scheduled post"
    ).example(
      '$0 posts:create -c "Draft post" -s "2024-12-31T12:00:00Z" -t draft -i "twitter-123"',
      "Create draft post"
    ).example(
      '$0 posts:create -c "Main post" -m "img1.jpg,img2.jpg" -s "2024-12-31T12:00:00Z" -i "twitter-123"',
      "Post with multiple images"
    ).example(
      '$0 posts:create -c "Main post" -m "img1.jpg" -c "First comment" -m "img2.jpg" -c "Second comment" -m "img3.jpg,img4.jpg" -s "2024-12-31T12:00:00Z" -i "twitter-123"',
      "Post with comments, each having their own media"
    ).example(
      '$0 posts:create -c "Main" -c "Comment with semicolon; see?" -c "Another!" -s "2024-12-31T12:00:00Z" -i "twitter-123"',
      "Comments can contain semicolons"
    ).example(
      '$0 posts:create -c "Thread 1/3" -c "Thread 2/3" -c "Thread 3/3" -d 5 -s "2024-12-31T12:00:00Z" -i "twitter-123"',
      "Twitter thread with 5 minute delay"
    ).example(
      "$0 posts:create --json ./post.json",
      "Complex post from JSON file"
    ).example(
      `$0 posts:create -c "Post to subreddit" -s "2024-12-31T12:00:00Z" --settings '{"subreddit":[{"value":{"subreddit":"programming","title":"My Title","type":"text","url":"","is_flair_required":false}}]}' -i "reddit-123"`,
      "Reddit post with specific subreddit settings"
    ).example(
      `$0 posts:create -c "Video description" -s "2024-12-31T12:00:00Z" --settings '{"title":"My Video","type":"public","tags":[{"value":"tech","label":"Tech"}]}' -i "youtube-123"`,
      "YouTube post with title and tags"
    ).example(
      `$0 posts:create -c "Tweet content" -s "2024-12-31T12:00:00Z" --settings '{"who_can_reply_post":"everyone"}' -i "twitter-123"`,
      "X (Twitter) post with reply settings"
    );
  },
  createPost
).command(
  "posts:list",
  "List all posts",
  (yargs2) => {
    return yargs2.option("startDate", {
      describe: "Start date (ISO 8601 format). Default: 30 days ago",
      type: "string"
    }).option("endDate", {
      describe: "End date (ISO 8601 format). Default: 30 days from now",
      type: "string"
    }).option("customer", {
      describe: "Customer ID (optional)",
      type: "string"
    }).example("$0 posts:list", "List all posts (last 30 days to next 30 days)").example(
      '$0 posts:list --startDate "2024-01-01T00:00:00Z" --endDate "2024-12-31T23:59:59Z"',
      "List posts for a specific date range"
    ).example(
      '$0 posts:list --customer "customer-id"',
      "List posts for a specific customer"
    );
  },
  listPosts
).command(
  "posts:delete <id>",
  "Delete a post",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Post ID to delete",
      type: "string"
    }).example("$0 posts:delete abc123", "Delete post with ID abc123");
  },
  deletePost
).command(
  "posts:missing <id>",
  "List available content from the provider for a post with missing release ID",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Post ID",
      type: "string"
    }).example(
      "$0 posts:missing post-123",
      "Get available content to connect to a post"
    );
  },
  getMissingContent
).command(
  "posts:status <id>",
  "Change a post status between draft and schedule",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Post ID",
      type: "string"
    }).option("status", {
      alias: "s",
      describe: 'New status: "draft" or "schedule"',
      type: "string",
      choices: ["draft", "schedule"],
      demandOption: true
    }).example(
      "$0 posts:status post-123 --status draft",
      "Move a scheduled post back to draft (stops the running workflow)"
    ).example(
      "$0 posts:status post-123 --status schedule",
      "Schedule a draft post so it is queued for publishing"
    );
  },
  changePostStatus
).command(
  "posts:connect <id>",
  "Connect a post to its published content by updating the release ID",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Post ID",
      type: "string"
    }).option("release-id", {
      describe: "The platform-specific content ID to connect",
      type: "string",
      demandOption: true
    }).example(
      '$0 posts:connect post-123 --release-id "7321456789012345678"',
      "Connect a post to its published content"
    );
  },
  connectPost
).command(
  "integrations:list",
  "List all connected integrations",
  (yargs2) => {
    return yargs2.option("group", {
      describe: "Filter integrations by group (customer) ID",
      type: "string"
    }).example("$0 integrations:list", "List all connected integrations").example(
      '$0 integrations:list --group "customer-id"',
      "List integrations for a specific group"
    );
  },
  listIntegrations
).command(
  "integrations:groups",
  "List all groups (customers)",
  {},
  listGroups
).command(
  "integrations:settings <id>",
  "Get settings schema for a specific integration",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Integration ID",
      type: "string"
    }).example(
      "$0 integrations:settings reddit-123",
      "Get settings schema for Reddit integration"
    ).example(
      "$0 integrations:settings youtube-456",
      "Get settings schema for YouTube integration"
    );
  },
  getIntegrationSettings
).command(
  "integrations:trigger <id> <method>",
  "Trigger an integration tool to fetch additional data",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Integration ID",
      type: "string"
    }).positional("method", {
      describe: "Method name from the integration tools",
      type: "string"
    }).option("data", {
      alias: "d",
      describe: "Data to pass to the tool as JSON string",
      type: "string"
    }).example(
      "$0 integrations:trigger reddit-123 getSubreddits",
      "Get list of subreddits"
    ).example(
      `$0 integrations:trigger reddit-123 searchSubreddits -d '{"query":"programming"}'`,
      "Search for subreddits"
    ).example(
      "$0 integrations:trigger youtube-123 getPlaylists",
      "Get YouTube playlists"
    );
  },
  triggerIntegrationTool
).command(
  "analytics:platform <id>",
  "Get analytics for a specific integration/channel",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Integration ID",
      type: "string"
    }).option("date", {
      alias: "d",
      describe: "Number of days to look back (default: 7)",
      type: "string",
      default: "7"
    }).example(
      "$0 analytics:platform integration-123",
      "Get last 7 days of analytics"
    ).example(
      "$0 analytics:platform integration-123 -d 30",
      "Get last 30 days of analytics"
    );
  },
  getAnalytics
).command(
  "analytics:post <id>",
  "Get analytics for a specific post",
  (yargs2) => {
    return yargs2.positional("id", {
      describe: "Post ID",
      type: "string"
    }).option("date", {
      alias: "d",
      describe: "Number of days to look back (default: 7)",
      type: "string",
      default: "7"
    }).example(
      "$0 analytics:post post-123",
      "Get last 7 days of post analytics"
    ).example(
      "$0 analytics:post post-123 -d 30",
      "Get last 30 days of post analytics"
    );
  },
  getPostAnalytics
).command(
  "upload <file>",
  "Upload a file",
  (yargs2) => {
    return yargs2.positional("file", {
      describe: "File path to upload",
      type: "string"
    }).example("$0 upload ./image.png", "Upload an image");
  },
  uploadFile
).command(
  "brain:schema",
  "Show which brain categories and documents exist",
  {},
  brainSchema
).command(
  "brain:list",
  "Read the agent brain",
  (yargs2) => {
    return yargs2.option("category", {
      describe: "Only one category: foundation, sources, experience or channels",
      type: "string"
    }).example(
      "$0 brain:list --category foundation",
      "Read the Foundation documents"
    );
  },
  brainList
).command(
  "brain:get <category> <key>",
  "Read one brain document",
  (yargs2) => {
    return yargs2.positional("category", {
      describe: "foundation, sources, experience or channels",
      type: "string"
    }).positional("key", { describe: "Document key", type: "string" }).example("$0 brain:get foundation icp", "Read the ICP document");
  },
  brainGet
).command(
  "brain:set <category> <key>",
  "Replace a brain document (asks for approval)",
  (yargs2) => {
    return yargs2.positional("category", {
      describe: "foundation, sources or channels",
      type: "string"
    }).positional("key", { describe: "Document key", type: "string" }).option("file", {
      describe: "Path to a JSON file of rules",
      type: "string"
    }).option("rules", { describe: "Inline JSON of rules", type: "string" }).example(
      "$0 brain:set foundation icp --file icp.json",
      "Replace the ICP document with the rules in icp.json"
    ).example(
      "$0 brain:set foundation branding-assets --file brand.json",
      "Rules plus files, where each file url comes from `voholabs upload`"
    );
  },
  brainSet
).command(
  "brain:delete <category> <key>",
  "Delete a brain document (asks for approval)",
  (yargs2) => {
    return yargs2.positional("category", {
      describe: "Category of the document",
      type: "string"
    }).positional("key", { describe: "Document key", type: "string" }).example("$0 brain:delete sources abc123", "Delete a source document");
  },
  brainDelete
).command(
  "auth:login",
  "Authenticate using OAuth2 (device flow)",
  (yargs2) => {
    return yargs2.option("auth-server", {
      describe: "Auth server URL (default: https://studio.voholabs.com/api)",
      type: "string"
    }).example(
      "$0 auth:login",
      "Login via OAuth2 device flow"
    );
  },
  authLogin
).command(
  "auth:logout",
  "Remove stored OAuth2 credentials",
  {},
  authLogout
).command(
  "auth:status",
  "Show current authentication status",
  {},
  authStatus
).demandCommand(1, "You need at least one command").help().alias("h", "help").version().alias("v", "version").epilogue(
  "For more information, visit: https://studio.voholabs.com\n\nAuthentication:\n  OAuth2: voholabs auth:login\n  API Key: export VOHOLABS_API_KEY=your_api_key\n\n\u{1F4FD}\uFE0F  Recommendation: Use agent-media to generate AI videos & images (Kling, Veo, Sora, Seedance, Flux, Grok) and post them directly with Postiz.\n   Install: npm install -g agent-media-cli\n   Learn more: https://agent-media.ai"
).parse();
//# sourceMappingURL=index.js.map