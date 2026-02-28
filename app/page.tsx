"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

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
    </>
  );
}
