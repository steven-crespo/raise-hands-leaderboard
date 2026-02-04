#!/usr/bin/env node
/**
 * Extract raise-hand winners from Obsidian markdown files.
 *
 * Usage:
 *   node extract.js \
 *     "/Users/stevencrespo/Documents/Obsidian Vault/Work/Daily Notes" \
 *     "./site/data"
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_TEAM = "GAMEON";

// Tag should match as its own token on a line (not "foo#raise-hand-winnerbar")
const TAG = "#raise-hand-winner";
const TAG_TOKEN_RE = /(^|\s)#raise-hand-winner(\s|$)/;

// Headings / fenced code blocks end a captured block (after at least one winner found)
const HEADING_RE = /^#+\s+/;
const FENCE_RE = /^```/;

// Team separators: hyphen, colon, en dash, em dash
// Allow spaces around them. Example: "ZC - Christy", "ZC: Christy", "ZC—Christy", "GAMEON – Kimmy"
const TEAM_NAME_RE = /^([A-Za-z0-9_]{2,20})\s*[-:–—]\s*(.+)$/;

// Date from filename: YYYY-MM-DD anywhere in the basename
const DATE_IN_FILENAME_RE = /(\d{4}-\d{2}-\d{2})/;

function isMeaninglessLine(s) {
  // After normalization, ignore empty, single dash, empty task boxes, etc.
  if (!s) return true;
  const t = s.trim();
  if (!t) return true;
  if (t === "-" || t === "*" || t === "+") return true;
  if (t === "[]" || t === "[ ]" || t === "- [ ]" || t === "* [ ]") return true;
  return false;
}

function normalizeWinnerLine(line) {
  let s = line.trim();

  // Strip bullet prefixes: "- ", "* ", "+ "
  s = s.replace(/^[-*+]\s+/, "");

  // Collapse repeated spaces (optional but nice)
  s = s.replace(/\s{2,}/g, " ").trim();

  return s;
}

function parseTeamAndWinner(line) {
  const s = normalizeWinnerLine(line);
  if (isMeaninglessLine(s)) return null;

  const m = s.match(TEAM_NAME_RE);
  if (m) {
    const team = m[1].trim().toUpperCase();
    const winner = m[2].trim();
    if (!winner) return null;
    return { team, winner };
  }

  // No team prefix => default team
  return { team: DEFAULT_TEAM, winner: s };
}

function inferDateFromFilename(filename) {
  const base = path.basename(filename);
  const m = base.match(DATE_IN_FILENAME_RE);
  return m ? m[1] : null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function walkMdFiles(dir) {
  const out = [];
  const stack = [dir];

  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      console.warn(`WARN: Cannot read directory: ${cur} (${e.message})`);
      continue;
    }

    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  return out;
}

function extractEventsFromFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.warn(`WARN: Cannot read file: ${filePath} (${e.message})`);
    return [];
  }

  const lines = content.split(/\r?\n/);
  const events = [];
  const date = inferDateFromFilename(filePath);
  const file = path.basename(filePath);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Look for tag token on the line.
    // Also avoid triggering on lines where the tag is part of another token.
    if (!TAG_TOKEN_RE.test(rawLine)) continue;

    // Extra guard: require the tag to be present as a standalone token
    // (the regex already handles whitespace boundaries, but keep it explicit)
    // We allow other text on the same line (e.g. "Today's ... #raise-hand-winner"),
    // but per spec we read winners from subsequent lines.
    let capturedAny = false;

    // Start scanning subsequent lines
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      const t = l.trim();

      // If we encounter another tag line, stop this block,
      // but let the outer loop see the new tag.
      if (TAG_TOKEN_RE.test(l)) {
        break;
      }

      // Stop conditions (after we captured at least one winner)
      if (capturedAny) {
        if (t === "") break;
        if (HEADING_RE.test(t)) break;
        if (FENCE_RE.test(t)) break;
      } else {
        // If we haven't captured yet, skip leading blank lines quietly
        if (t === "") continue;
        // If the very next content is a heading/code fence, treat as "no winners"
        // and stop scanning this block.
        if (HEADING_RE.test(t) || FENCE_RE.test(t)) break;
      }

      const parsed = parseTeamAndWinner(l);
      if (!parsed) continue;

      events.push({
        date,                // string "YYYY-MM-DD" or null
        team: parsed.team,   // uppercase for team
        winner: parsed.winner,
        file
      });

      capturedAny = true;
    }

    if (!capturedAny) {
      console.warn(`WARN: Tag found but no winners captured in file: ${file}`);
    }
  }

  return events;
}

function buildLeaderboardRows(events) {
  // team -> winner -> wins
  const counts = new Map();

  for (const e of events) {
    const team = (e.team || DEFAULT_TEAM).toUpperCase();
    const winner = e.winner;

    if (!counts.has(team)) counts.set(team, new Map());
    const inner = counts.get(team);
    inner.set(winner, (inner.get(winner) || 0) + 1);
  }

  // Flatten to rows
  const rows = [];
  for (const [team, inner] of counts.entries()) {
    for (const [winner, wins] of inner.entries()) {
      rows.push({ team, winner, wins });
    }
  }

  // Sort by wins desc, then team, then winner
  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.team !== b.team) return a.team.localeCompare(b.team);
    return a.winner.localeCompare(b.winner);
  });

  return rows;
}

function isoWithLocalTZ(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  const tzOffsetMin = date.getTimezoneOffset();
  const sign = tzOffsetMin > 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${sign}${hh}:${mm}`;
}

function main() {
  const sourceDir =
    process.argv[2] || "/Users/stevencrespo/Documents/Obsidian Vault/Work/Daily Notes";
  const outDir = process.argv[3] || path.join(__dirname, "site", "data");

  if (!fs.existsSync(sourceDir)) {
    console.error(`ERROR: Source directory does not exist:\n  ${sourceDir}`);
    process.exit(1);
  }

  ensureDir(outDir);

  const mdFiles = walkMdFiles(sourceDir);
  console.log(`Found ${mdFiles.length} markdown files under:\n  ${sourceDir}`);

  const allEvents = [];
  for (const f of mdFiles) {
    const ev = extractEventsFromFile(f);
    allEvents.push(...ev);
  }

  // Write events.json
  const eventsPath = path.join(outDir, "events.json");
  fs.writeFileSync(eventsPath, JSON.stringify(allEvents, null, 2), "utf8");
  console.log(`Wrote ${allEvents.length} events to:\n  ${eventsPath}`);

  // Write leaderboard.json (web-friendly rows)
  const leaderboardRows = buildLeaderboardRows(allEvents);
  const leaderboardPath = path.join(outDir, "leaderboard.json");
  fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboardRows, null, 2), "utf8");
  console.log(`Wrote ${leaderboardRows.length} leaderboard rows to:\n  ${leaderboardPath}`);

  // Write meta.json (last updated timestamp)
  const meta = {
    lastUpdated: isoWithLocalTZ(new Date())
  };

  const metaPath = path.join(outDir, "meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

main();

