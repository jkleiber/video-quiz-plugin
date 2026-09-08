# Video Quiz for YouTube — Docs

This folder documents the implementation of the idea in the top-level
[README.md](../README.md): a Chrome extension that watches a YouTube video
alongside you, and periodically pauses playback to quiz you on what was just
said, using the video's own transcript. It's aimed at language learners who
want an active-recall check on listening comprehension instead of passively
scrubbing through a video.

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together and why
- [QUIZ_GENERATION.md](QUIZ_GENERATION.md) — how questions are built from the transcript
- [USAGE.md](USAGE.md) — installing the unpacked extension and using it
- [LIMITATIONS.md](LIMITATIONS.md) — known gaps and what would need to change to close them
- [TESTING.md](TESTING.md) — how this was verified, and how to verify it yourself

## Why Chrome extension + plain JavaScript

The idea requires running code inside the browser, reading data off a live
YouTube page (the transcript, the `<video>` element), and overlaying UI on
top of the player — that's squarely what the Chrome Extensions platform
(Manifest V3) is for, and JavaScript is its only supported language. Plain
JS/HTML/CSS with no build step was chosen deliberately: it keeps "load
unpacked" trivial (no `npm install` / bundler needed to try it), and the
extension's logic is small enough that a bundler wouldn't earn its keep.
