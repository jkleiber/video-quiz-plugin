// Runs in the page's MAIN world (has access to window.ytInitialPlayerResponse),
// unlike the isolated content script. It only reads data and posts it via
// window.postMessage — it never talks to the extension APIs directly.
(function () {
  const SOURCE = "video-quiz-plugin";

  function getPlayerResponse() {
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
      // YouTube sometimes only refreshes this global on the player itself.
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        return player.getPlayerResponse();
      }
    } catch (e) {
      // Page structure changed or player not ready yet; caller retries.
    }
    return null;
  }

  function postCaptionTracks() {
    const pr = getPlayerResponse();
    const renderer =
      pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
    const tracks = renderer && renderer.captionTracks ? renderer.captionTracks : null;
    const videoId = pr && pr.videoDetails && pr.videoDetails.videoId;

    window.postMessage(
      {
        source: SOURCE,
        type: "CAPTION_TRACKS",
        videoId: videoId || null,
        tracks: tracks
          ? tracks.map((t) => ({
              baseUrl: t.baseUrl,
              languageCode: t.languageCode,
              name: t.name && t.name.simpleText,
              kind: t.kind || null, // "asr" means auto-generated
            }))
          : null,
      },
      "*"
    );
  }

  // YouTube's player data can take a moment to populate, and it's an SPA
  // (navigating between videos doesn't reload this script), so we retry a
  // few times after load and again whenever the isolated content script
  // asks us to (e.g. after a client-side navigation).
  postCaptionTracks();
  setTimeout(postCaptionTracks, 1000);
  setTimeout(postCaptionTracks, 3000);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === SOURCE && data.type === "REQUEST_CAPTION_TRACKS") {
      postCaptionTracks();
      setTimeout(postCaptionTracks, 1000);
      setTimeout(postCaptionTracks, 3000);
    }
  });
})();
