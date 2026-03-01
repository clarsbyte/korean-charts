import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scrapeYouTubeVideo } = require("../index.js");

export const runtime = "nodejs";

// Quota exceeded: block all calls for 25 hours after a quota error
let quotaExceededUntil: number | null = null;
const QUOTA_COOLDOWN_MS = 25 * 60 * 60 * 1000; // 25 hours

// Daily cap: YouTube search costs ~101 units; 10,000 units/day ÷ 101 ≈ 99 max
const MAX_DAILY_REQUESTS = 80;
let dailyRequestCount = 0;
let dailyWindowStart = Date.now();

// Global per-minute burst limit
const MAX_PER_MINUTE = 10;
const requestTimestamps: number[] = [];

// Per-IP rate limit: max 5 requests/minute per client
const MAX_PER_IP_PER_MINUTE = 7;
const ipTimestamps = new Map<string, number[]>();

function isQuotaError(message: string): boolean {
  return message.includes("quotaExceeded") || (message.includes("403") && message.toLowerCase().includes("quota"));
}

function resetDailyCounterIfNeeded() {
  if (Date.now() - dailyWindowStart >= 24 * 60 * 60 * 1000) {
    dailyRequestCount = 0;
    dailyWindowStart = Date.now();
  }
}

function isUnderPerMinuteLimit(): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  while (requestTimestamps.length && requestTimestamps[0] < oneMinuteAgo) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < MAX_PER_MINUTE;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isUnderIpLimit(ip: string): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const timestamps = ipTimestamps.get(ip) ?? [];
  const recent = timestamps.filter((t) => t > oneMinuteAgo);
  if (recent.length >= MAX_PER_IP_PER_MINUTE) return false;
  recent.push(now);
  ipTimestamps.set(ip, recent);
  // Periodically prune stale IPs to avoid unbounded memory growth
  if (ipTimestamps.size > 500) {
    for (const [key, ts] of ipTimestamps) {
      if (ts.every((t) => t <= oneMinuteAgo)) ipTimestamps.delete(key);
    }
  }
  return true;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const song = searchParams.get("song")?.trim() || "";
  const artist = searchParams.get("artist")?.trim() || "";

  if (!song) {
    return NextResponse.json({ error: "song is required" }, { status: 400 });
  }

  // Block if quota was already exceeded
  if (quotaExceededUntil !== null && Date.now() < quotaExceededUntil) {
    return NextResponse.json(
      { song, artist, error: "YouTube quota exceeded", quotaExceeded: true },
      { status: 429 },
    );
  }

  // Daily cap check
  resetDailyCounterIfNeeded();
  if (dailyRequestCount >= MAX_DAILY_REQUESTS) {
    return NextResponse.json(
      { song, artist, error: "Daily YouTube request limit reached", quotaExceeded: true },
      { status: 429 },
    );
  }

  // Per-IP spam check (checked before global limit so spammers don't burn shared quota)
  const ip = getClientIp(request);
  if (!isUnderIpLimit(ip)) {
    return NextResponse.json(
      { song, artist, error: "Too many requests, please slow down" },
      { status: 429 },
    );
  }

  // Global per-minute burst check
  if (!isUnderPerMinuteLimit()) {
    return NextResponse.json(
      { song, artist, error: "Too many requests, please slow down" },
      { status: 429 },
    );
  }

  dailyRequestCount++;
  requestTimestamps.push(Date.now());

  try {
    const result = await scrapeYouTubeVideo(song, artist);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected YouTube scraping error";
    if (isQuotaError(message)) {
      quotaExceededUntil = Date.now() + QUOTA_COOLDOWN_MS;
      return NextResponse.json(
        { song, artist, error: message, quotaExceeded: true },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { song, artist, error: message },
      { status: 500 },
    );
  }
}
