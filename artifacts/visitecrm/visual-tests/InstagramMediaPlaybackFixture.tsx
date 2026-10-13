import { createElement } from "react";
import { MessageMediaAttachment } from "../src/pages/communication/CommunicationInboxTabs";

export function InstagramMediaPlaybackFixture({ mediaBase }: { mediaBase: string }) {
  const mediaUrl = (path: string) => new URL(path, mediaBase).toString();

  return createElement(
    "main",
    { className: "mx-auto flex max-w-md flex-col gap-6 p-4" },
    createElement(
      "section",
      { "data-testid": "instagram-audio-fixture" },
      createElement("h1", null, "Áudio recebido"),
      createElement(MessageMediaAttachment, {
        url: mediaUrl("/instagram-audio.mp3"),
        mimeType: "audio/mpeg",
        fileName: "voice-note.mp3",
        expiredAt: null,
      }),
    ),
    createElement(
      "section",
      { "data-testid": "instagram-video-fixture" },
      createElement("h2", null, "Vídeo recebido"),
      createElement(MessageMediaAttachment, {
        url: mediaUrl("/instagram-video.mp4"),
        mimeType: "video/mp4",
        fileName: "clip.mp4",
        expiredAt: null,
      }),
    ),
    createElement(
      "section",
      { "data-testid": "instagram-failed-video-fixture" },
      createElement("h2", null, "Vídeo indisponível"),
      createElement(MessageMediaAttachment, {
        url: mediaUrl("/missing-video.mp4"),
        mimeType: "video/mp4",
        fileName: "missing.mp4",
        expiredAt: null,
      }),
    ),
  );
}
