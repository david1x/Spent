# Watching bank syncs in Docker

On a server there is no screen, so Spent's bank browser normally runs hidden.
The optional **screen container** (`docker-compose.screen.yml`) gives it a
virtual screen that you open in your own browser. Use it to watch a bank sign
in, solve a captcha, or type a one-time code the bank asks for.

You don't need it for Bank Hapoalim or One Zero: Spent asks for their code in
the sync window itself.

## How it fits together

```
your computer                        server (Docker)
-------------                        ---------------------------------------
browser  --->  SSH tunnel  --->  127.0.0.1:6080  --->  spent-screen (noVNC)
                                                          ^
                                                          | draws on screen:0
                                                       spent (Chromium)
```

- `spent-screen` runs a virtual screen (Xvfb), shares it over VNC, and serves
  a web viewer (noVNC) on port 6080.
- `spent` gets `DISPLAY=screen:0`, so when an account is set to show the
  browser, Chromium opens on that screen instead of headless.
- Port 6080 only answers on the server itself (`127.0.0.1`). From another
  machine you reach it through an SSH tunnel, which also encrypts it.

## One-time setup (on the server)

1. Pick a password, 6 to 8 characters (VNC only reads the first 8), and add it
   to `.env` next to `docker-compose.yml`:

   ```bash
   echo "SPENT_SCREEN_PASSWORD=pick-one" >> .env
   ```

2. Make the screen part of every `docker compose` command:

   ```bash
   echo "COMPOSE_FILE=docker-compose.yml:docker-compose.screen.yml" >> .env
   ```

3. Start it:

   ```bash
   docker compose up -d --build
   ```

4. Check both containers are up:

   ```bash
   docker ps --filter name=spent
   ```

   `spent-screen` should say `(healthy)`.

Without step 2, every command needs both files:
`docker compose -f docker-compose.yml -f docker-compose.screen.yml up -d --build`.

## Every time you want to watch a sync

1. **Open the tunnel** from the machine you're sitting at (Windows, macOS and
   Linux all have `ssh`):

   ```bash
   ssh -N -L 6080:127.0.0.1:6080 user@SERVER_IP
   ```

   - `-N` means "just the tunnel, no shell". The command looks like it hangs;
     that's normal. Leave the window open.
   - SSH on another port? Add `-p 2222`.

2. **Open the viewer** in a browser on the same machine:

   <http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale>

   Enter the screen password. A black screen is normal: nothing is syncing yet.

3. **Turn on the browser for the account** (once per account): in Spent, open
   the bank's details and switch on **Show the browser when syncing this
   account**. To show it for every account, use **Settings → Show browser
   during sync** instead.

4. **Press Sync** in Spent. The bank's Chromium window appears in the viewer.
   Click into it and type the code, or solve the captcha. The sync continues on
   its own.

5. **Close the tunnel** when done: `Ctrl+C` in the SSH window.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `bind: Address already in use` when opening the tunnel | Port 6080 is taken on your machine. Use another local port: `ssh -N -L 16080:127.0.0.1:6080 user@SERVER_IP`, then open `http://127.0.0.1:16080/vnc.html?autoconnect=1&resize=scale`. |
| Viewer page doesn't load | Is the tunnel window still open? Is the container up: `docker ps --filter name=spent-screen`? |
| Wrong password / forgot it | Change `SPENT_SCREEN_PASSWORD` in `.env`, then `docker compose up -d` (it recreates the container with the new one). |
| Sync runs but no window appears | Check the account's switch is on, and that Spent sees the screen: `docker exec spent printenv DISPLAY` should print `screen:0`. If it prints nothing, the screen file isn't in use (see setup step 2). |
| Screen container keeps restarting | `docker logs spent-screen`. The usual cause is a missing `SPENT_SCREEN_PASSWORD`. |
| Window is cut off | Make the screen bigger with `SPENT_SCREEN_SIZE=1600x1000` in `.env`, then `docker compose up -d`. |

## Settings (`.env`)

| Variable | Default | What it does |
| --- | --- | --- |
| `SPENT_SCREEN_PASSWORD` | (required) | Password for the viewer, 6 to 8 characters |
| `SPENT_SCREEN_PORT` | `6080` | Port on the server (still `127.0.0.1` only) |
| `SPENT_SCREEN_SIZE` | `1366x900` | Size of the virtual screen |

## Turning it off

Remove the `COMPOSE_FILE=...` line from `.env`, then:

```bash
docker compose up -d --remove-orphans
```

Spent goes back to running the browser hidden, and the screen container is
removed.

## Security notes

- The viewer is plain HTTP with a short VNC password, which is why it only
  listens on `127.0.0.1` and you reach it over SSH. Don't change the port line
  to `"6080:6080"` on a server reachable from the internet.
- Whoever has the viewer open sees the bank's pages while a sync runs.
- The screen itself (X on port 6000) has no access control, but it is only
  reachable by containers on the compose network, never from outside.
