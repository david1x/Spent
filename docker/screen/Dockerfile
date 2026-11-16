# A virtual screen for Spent's bank browser, viewable from your own browser.
# Xvfb is the screen, x11vnc shares it, noVNC serves the viewer on port 6080.
# Spent's container draws Chromium here through DISPLAY=screen:0.

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify procps \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1000 screen
COPY --chmod=755 start.sh /usr/local/bin/start-screen
USER screen
EXPOSE 6080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -x Xvfb >/dev/null && pgrep -x x11vnc >/dev/null || exit 1
CMD ["start-screen"]
