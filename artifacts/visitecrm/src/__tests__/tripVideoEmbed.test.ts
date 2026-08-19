import { describe, expect, it } from "vitest";
import { getTripVideoEmbedUrl } from "@/lib/tripVideoEmbed";

describe("getTripVideoEmbedUrl", () => {
  it.each([
    ["YouTube watch links", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["short YouTube links", "https://youtu.be/dQw4w9WgXcQ?t=43", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["Vimeo links", "https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
    ["nested Vimeo links", "https://vimeo.com/channels/staffpicks/76979871", "https://player.vimeo.com/video/76979871"],
  ])("converts %s to an embed URL", (_label, url, embedUrl) => {
    expect(getTripVideoEmbedUrl(url)).toBe(embedUrl);
  });

  it.each([
    "https://cdn.example.com/videos/viagem.mp4",
    "https://cdn.example.com/videos/viagem.webm",
    "https://youtube.com/watch?v=too-short",
    "https://youtube.com.example/watch?v=dQw4w9WgXcQ",
    "not a URL",
  ])("leaves non-embeddable URLs for the native video player: %s", (url) => {
    expect(getTripVideoEmbedUrl(url)).toBeNull();
  });
});