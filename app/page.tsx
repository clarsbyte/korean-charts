"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { MoreVertical } from "lucide-react";
import StoryShareModal, { ChartStats } from "./components/StoryShareModal";

type ChartItem = {
  rank: string;
  songTitle: string;
  artist: string;
  album: string;
  songId: string | null;
  artistId: string | null;
};

type ChartSource = {
  source: string;
  items: ChartItem[];
  count: number;
  error: string | null;
};

type ChartsResponse = {
  generatedAt: string;
  sources: ChartSource[];
  error?: string;
};

const SOURCE_COLORS: Record<string, string> = {
  bugs: "#e8185a",
  melon: "#16a34a",
  flo: "#2563eb",
  genie: "#9333ea",
  naver: "#03c75a",
  hanteo: "#d97706",
};

const Nav = () => (
  <nav className="site-nav">
    <Image src="/logo.png" alt="Korean Charts logo" width={32} height={32} className="logo" />
    <Link href="/simulator" className="nav-btn">Music Show Simulator →</Link>
  </nav>
);

export default function Home() {
  const [data, setData] = useState<ChartsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareItem, setShareItem] = useState<{
    songTitle: string;
    artist: string;
    chartStats: ChartStats[];
  } | null>(null);

  /** Normalize text: lowercase, strip brackets/feat, keep letters+numbers+spaces */
  const normalizeText = (value: string) =>
    value
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/feat\.?|ft\.?|featuring|with|prod\.?/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Escape special regex characters */
  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Build a regex that checks all significant tokens are present */
  const toTokenRegex = (value: string): RegExp | null => {
    const tokens = normalizeText(value)
      .split(" ")
      .filter(Boolean)
      .slice(0, 10);
    if (!tokens.length) return null;
    return new RegExp(
      tokens.map((t) => `(?=.*${escapeRegExp(t)})`).join("") + ".*",
      "iu",
    );
  };

  /** Token-based matching: checks that all significant tokens of one string appear in the other (bidirectional) */
  const isSameTrack = (
    baseTitle: string,
    baseArtist: string,
    itemTitle: string,
    itemArtist: string
  ) => {
    const titleRegex = toTokenRegex(baseTitle);
    const itemTitleRegex = toTokenRegex(itemTitle);
    const artistRegex = toTokenRegex(baseArtist);
    const itemArtistRegex = toTokenRegex(itemArtist);

    // Title must match in at least one direction
    const titleMatch = titleRegex
      ? titleRegex.test(itemTitle) || (itemTitleRegex?.test(baseTitle) === true)
      : itemTitleRegex
        ? itemTitleRegex.test(baseTitle)
        : normalizeText(baseTitle) === normalizeText(itemTitle);

    // Artist must match in at least one direction (empty artist = always match)
    const artistMatch = artistRegex
      ? artistRegex.test(itemArtist) || (itemArtistRegex?.test(baseArtist) === true)
      : true;

    return titleMatch && artistMatch;
  };

  const handleShareClick = (songTitle: string, artist: string) => {
    if (!data) return;

    // Aggregate stats from all sources for this song + artist
    const stats: ChartStats[] = [];

    data.sources.forEach(source => {
      if (source.source.toLowerCase() === "hanteo") return;
      const match = source.items.find(item =>
        isSameTrack(songTitle, artist, item.songTitle, item.artist)
      );
      if (match) {
        const rankNum = Number.parseInt(match.rank, 10);
        if (Number.isFinite(rankNum) && rankNum >= 1 && rankNum <= 20) {
          stats.push({ source: source.source, rank: match.rank });
        }
      }
    });

    setShareItem({
      songTitle,
      artist,
      chartStats: stats
    });
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/fetching", { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        setData((await response.json()) as ChartsResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chart data");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) return "";
    return new Date(data.generatedAt).toLocaleString();
  }, [data?.generatedAt]);

  if (isLoading) {
    return (
      <>
        <Nav />
        <main className="page">
          <div className="loading-wrap">
            <div className="loading-dots"><span /><span /><span /></div>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Nav />
        <main className="page">
          <p className="status error">{error}</p>
        </main>
      </>
    );
  }

  const digitalSources = data?.sources.filter((s) => s.source !== "hanteo") ?? [];
  const hanteoSource = data?.sources.find((s) => s.source === "hanteo") ?? null;

  return (
    <>
      <Nav />
      <main className="page">
        <header className="header">
          <h1 className="bold">Live Charts</h1>
          <p>{generatedLabel ? `Updated ${generatedLabel}` : "Live chart snapshot"}</p>
        </header>

        {/* Digital charts grid */}
        <section className="grid" aria-label="Digital chart sources">
          {digitalSources.map((source) => (
            <article
              key={source.source}
              className="card"
              style={{ "--source-color": SOURCE_COLORS[source.source] ?? "#e8185a" } as React.CSSProperties}
            >
              <div className="card-stripe" />
              <div className="cardHead">
                <h2>{source.source.toUpperCase()}</h2>
              </div>

              {source.error ? (
                <p className="status error">{source.error}</p>
              ) : (
                <ol className="list">
                  {source.items.slice(0, 20).map((item) => (
                    <li key={`${source.source}-${item.rank}-${item.songTitle}`} className="row">
                      <span className="rank">{item.rank}</span>
                      <div>
                        <p className="title">{item.songTitle}</p>
                        <p className="meta">
                          {item.artist}
                          {item.album ? ` · ${item.album}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => handleShareClick(item.songTitle, item.artist)}
                        className="p-1.5 text-[var(--muted)] hover:text-[var(--accent)] transition-colors rounded-full hover:bg-[var(--line)]"
                        aria-label={`Share ${item.songTitle} to Instagram Story`}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          ))}
        </section>

        {/* Hanteo Album Chart */}
        {hanteoSource && (
          <section className="hanteo-wrap" aria-label="Hanteo album chart">
            <div className="hanteo-hd">
              <div className="hanteo-hd-left">
                <span className="hanteo-label">HANTEO</span>
                <span className="hanteo-sublabel">Album Chart</span>
              </div>

            </div>

            {hanteoSource.error ? (
              <p className="status error">{hanteoSource.error}</p>
            ) : (
              <div className="hanteo-scroll">
                {hanteoSource.items.slice(0, 50).map((item) => (
                  <div key={`hanteo-${item.rank}`} className="hcard">
                    <span className="hcard-rank">{item.rank}</span>
                    <p className="hcard-album">{item.songTitle}</p>
                    <p className="hcard-artist">{item.artist}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {shareItem && (
        <StoryShareModal
          songTitle={shareItem.songTitle}
          artist={shareItem.artist}
          chartStats={shareItem.chartStats}
          onClose={() => setShareItem(null)}
        />
      )}
    </>
  );
}
