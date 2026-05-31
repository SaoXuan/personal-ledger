const Decimal = require("decimal.js");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(customParseFormat);

function parseKeyValueText(text) {
  if (!text || !text.trim()) return {};
  const out = {};
  const lines = text
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function objectToPrettyKv(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function safeJsonParse(text, fallback = {}) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeCurrency(currency) {
  return String(currency || "CNY").trim().toUpperCase();
}

function normalizeDate(dateValue) {
  return dayjs(dateValue).format("YYYY-MM-DD");
}

function isDateString(value) {
  return dayjs(value, "YYYY-MM-DD", true).isValid();
}

function decimal(value) {
  try {
    return new Decimal(value || 0);
  } catch {
    return new Decimal(0);
  }
}

function decimalToString(value, digits = 2) {
  return decimal(value).toFixed(digits);
}

module.exports = {
  parseKeyValueText,
  objectToPrettyKv,
  safeJsonParse,
  normalizeCurrency,
  normalizeDate,
  isDateString,
  decimal,
  decimalToString,
};
