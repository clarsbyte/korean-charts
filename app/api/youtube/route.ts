import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scrapeYouTubeVideo } = require("../index.js");

export const runtime = "nodejs";

// In-memory rate limit: once quota is exceeded, stop calling YouTube until reset
let quotaExceededUntil: number | null = null;
const QUOTA_COOLDOWN_MS = 25 * 60 * 60 * 1000; // 25 hours (YouTube quota resets daily)

function isQuotaError(message: string): boolean {
  return message.includes("quotaExceeded") || (message.includes("403") && message.toLowerCase().includes("quota"));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const song = searchParams.get("song")?.trim() || "";
  const artist = searchParams.get("artist")?.trim() || "";

  if (!song) {
    return NextResponse.json({ error: "song is required" }, { status: 400 });
  }

  // Rate-limit: return early if quota is still exceeded
  if (quotaExceededUntil !== null && Date.now() < quotaExceededUntil) {
    return NextResponse.json(
      { song, artist, error: "YouTube quota exceeded", quotaExceeded: true },
      { status: 429 },
    );
  }

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
