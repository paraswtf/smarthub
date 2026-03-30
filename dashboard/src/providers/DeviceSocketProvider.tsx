"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { appConfig } from "../../globals.config";

export interface DeviceUpdate {
	type: "device_update";
	deviceId: string;
	lastSeenAt: string;
	relays: { id: string; state: boolean }[];
}

export interface RelayUpdate {
	type: "relay_update";
	deviceId: string;
	relayId: string;
	state: boolean;
}

type WsMessage = DeviceUpdate | RelayUpdate;
type Listener<T> = (msg: T) => void;

interface DeviceSocketContextValue {
	connected: boolean;
	onDeviceUpdate: (fn: Listener<DeviceUpdate>) => () => void;
	onRelayUpdate: (fn: Listener<RelayUpdate>) => () => void;
}

const DeviceSocketContext = createContext<DeviceSocketContextValue | null>(null);

export function DeviceSocketProvider({ userId, children }: { userId: string | null | undefined; children: ReactNode }) {
	const wsRef = useRef<WebSocket | null>(null);
	const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);
	const userIdRef = useRef(userId);

	const [connected, setConnected] = useState(false);

	// These Sets persist for the lifetime of the provider — never recreated
	const deviceListeners = useRef<Set<Listener<DeviceUpdate>>>(new Set());
	const relayListeners = useRef<Set<Listener<RelayUpdate>>>(new Set());

	// Stable subscription functions — never change reference
	const onDeviceUpdate = useCallback((fn: Listener<DeviceUpdate>) => {
		deviceListeners.current.add(fn);
		console.log(`[WS Provider] deviceUpdate listener added (total: ${deviceListeners.current.size})`);
		return () => {
			deviceListeners.current.delete(fn);
			console.log(`[WS Provider] deviceUpdate listener removed (total: ${deviceListeners.current.size})`);
		};
	}, []);

	const onRelayUpdate = useCallback((fn: Listener<RelayUpdate>) => {
		relayListeners.current.add(fn);
		console.log(`[WS Provider] relayUpdate listener added (total: ${relayListeners.current.size})`);
		return () => {
			relayListeners.current.delete(fn);
			console.log(`[WS Provider] relayUpdate listener removed (total: ${relayListeners.current.size})`);
		};
	}, []);

	// Connect / reconnect — called whenever userId becomes available or changes
	const connect = useCallback(() => {
		const uid = userIdRef.current;
		if (!uid || !mountedRef.current) return;

		// Close existing connection cleanly before opening a new one
		if (wsRef.current) {
			wsRef.current.onclose = null; // prevent retry loop from firing
			wsRef.current.close();
			wsRef.current = null;
		}
		if (retryRef.current) {
			clearTimeout(retryRef.current);
			retryRef.current = null;
		}

		const base = appConfig.apiBaseUrl;
		const wsBase = base.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
		const wsPort = process.env.NEXT_PUBLIC_WS_PORT;
		const wsUrl = wsPort ? `${wsBase.replace(/:\d+$/, "")}:${wsPort}/browser` : `${wsBase.replace(/:\d+$/, "")}/browser`;

		console.log(`[WS Provider] connecting to ${wsUrl} as userId=${uid}`);
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			ws.send(JSON.stringify({ type: "subscribe", userId: uid }));
			setConnected(true);
			console.log(`[WS Provider] connected & subscribed`);
		};

		ws.onmessage = (event) => {
			let msg: WsMessage;
			try {
				msg = JSON.parse(event.data as string) as WsMessage;
			} catch {
				return;
			}

			if (msg.type === "device_update") {
				console.log(`[WS Provider] device_update → ${deviceListeners.current.size} listeners`);
				deviceListeners.current.forEach((fn) => fn(msg));
			}
			if (msg.type === "relay_update") {
				console.log(`[WS Provider] relay_update → ${relayListeners.current.size} listeners`);
				relayListeners.current.forEach((fn) => fn(msg));
			}
		};

		ws.onclose = () => {
			wsRef.current = null;
			setConnected(false);
			if (!mountedRef.current) return;
			console.log(`[WS Provider] disconnected — retrying in ${appConfig.wsReconnectInterval}ms`);
			retryRef.current = setTimeout(connect, appConfig.wsReconnectInterval);
		};

		ws.onerror = () => ws.close();
	}, []); // stable — reads userId from ref

	// Mount once — listeners Set lives for the full component lifetime
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (retryRef.current) clearTimeout(retryRef.current);
			if (wsRef.current) {
				wsRef.current.onclose = null;
				wsRef.current.close();
			}
		};
	}, []);

	// Connect/reconnect when userId becomes available or changes
	useEffect(() => {
		userIdRef.current = userId;
		if (userId) connect();
	}, [userId, connect]);

	return <DeviceSocketContext.Provider value={{ connected, onDeviceUpdate, onRelayUpdate }}>{children}</DeviceSocketContext.Provider>;
}

export function useDeviceSocket() {
	const ctx = useContext(DeviceSocketContext);
	if (!ctx) throw new Error("useDeviceSocket must be used inside <DeviceSocketProvider>");
	return ctx;
}
