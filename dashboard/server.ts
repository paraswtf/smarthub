/**
 * Custom Next.js dev server - runs Next.js + WebSocket server on the same port.
 * Mirrors Caddy's WebSocket routing in production (ws upgrade on same domain).
 *
 * Usage: npm run dev (via tsx watch server.ts)
 */

import { createServer } from "http";
import { networkInterfaces } from "os";
import { parse } from "url";
import next from "next";
import { wsRequestHandler, attachWss } from "./src/server/ws-server";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
	const { pathname } = parse(req.url ?? "/");

	// Route internal WS HTTP endpoints to WS handler
	if (
		pathname === "/push-relay" ||
		pathname === "/push-relay-update" ||
		pathname === "/push-relay-add" ||
		pathname === "/push-switch-add" ||
		pathname === "/push-switch-update" ||
		pathname === "/push-switch-delete" ||
		pathname === "/ping-device" ||
		pathname === "/refresh-device-subscribers"
	) {
		void wsRequestHandler(req, res);
		return;
	}

	// Everything else goes to Next.js
	void handle(req, res);
});

attachWss(server);

server.listen(port, () => {
	const nets = networkInterfaces();
	const localIp = Object.values(nets)
		.flat()
		.find((n) => n?.family === "IPv4" && !n.internal)?.address;

	console.log(`> Ready on http://localhost:${port}`);
	if (localIp) console.log(`> Network: http://${localIp}:${port}`);
});
