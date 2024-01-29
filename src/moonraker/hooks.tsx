'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UseMutationOptions, UseQueryOptions, useMutation, useQuery } from '@tanstack/react-query';
import useWebSocket from 'react-use-websocket';
import { migrateToLatest } from './migrations';
import {
	InFlightRequestCallbacks,
	InFlightRequestTimeouts,
	MoonrakerResponse,
	MoonrakerStatus,
	MoonrakerSaveItemFn,
	MoonrakerNamespaces,
	MoonrakerDBItemResponse,
	MoonrakerGetItemFn,
	MoonrakerNamespaceKeys,
	MoonrakerDBValue,
	MoonrakerQueryFn,
} from './types';
import { getHost } from '../helpers/util';

let REQ_ID = 0;

const getWsURL = () => {
	const host = getHost();
	if (host == null || host.trim() == '') {
		return null;
	}
	return `ws://${host}/websocket`;
};

export const useMoonraker = () => {
	const inFlightRequests = useRef<InFlightRequestCallbacks>({});
	const inFlightRequestTimeouts = useRef<InFlightRequestTimeouts>({});
	const onReadyCallbacks = useRef<{ resolve: () => void; reject: () => void }[]>([]);
	const [wsUrl, setWsUrl] = useState(getWsURL());
	useEffect(() => {
		setWsUrl(getWsURL());
	}, []);
	const { lastJsonMessage, sendJsonMessage, readyState } = useWebSocket<MoonrakerResponse>(wsUrl, {
		shouldReconnect: (closeEvent) => {
			return true;
		},
		reconnectAttempts: Infinity,
		reconnectInterval: 3000,
		share: true,
	});
	const readyStateRef = useRef(readyState);
	readyStateRef.current = readyState;
	const [moonrakerStatus, setMoonrakerStatus] = useState<null | MoonrakerStatus>(
		readyState === 1 ? 'connected' : 'connecting',
	);
	const [moonrakerMessage, setMoonrakerMessage] = useState<null | MoonrakerResponse>(lastJsonMessage);

	const whenReady = useCallback((resolve: () => void, reject: () => void) => {
		if (readyStateRef.current === 1) {
			resolve();
		} else {
			onReadyCallbacks.current.push({ resolve, reject });
		}
	}, []);

	const isReady = useCallback(
		() =>
			new Promise<void>((resolve, reject) => {
				whenReady(resolve, reject);
			}),
		[whenReady],
	);

	const moonrakerQuery: MoonrakerQueryFn = useCallback(
		async <Response = any,>(method: string, params: any = {}) => {
			await isReady();
			return new Promise<Response>((resolve, reject) => {
				sendJsonMessage({
					jsonrpc: '2.0',
					method,
					params,
					id: ++REQ_ID,
				});
				inFlightRequests.current[REQ_ID] = (err, result) => {
					if (err) {
						return reject(err);
					}
					if (result?.error) {
						return reject(result.error);
					}
					resolve(result);
				};
				inFlightRequestTimeouts.current[REQ_ID] = window.setTimeout(() => {
					inFlightRequests.current[REQ_ID]?.(new Error('Request timed out'), null);
					delete inFlightRequests.current[REQ_ID];
					delete inFlightRequestTimeouts.current[REQ_ID];
				}, 10 * 1000); // 10 second timeout.
			});
		},
		[isReady, sendJsonMessage],
	);

	const saveItem = useCallback<MoonrakerSaveItemFn>(
		async <Data,>(namespace: MoonrakerNamespaces, key: unknown, value: unknown) => {
			await isReady();
			return (await moonrakerQuery('server.database.post_item', {
				namespace: namespace,
				key,
				value: value,
			})) as Data;
		},
		[moonrakerQuery, isReady],
	);

	const getItem = useCallback<MoonrakerGetItemFn>(
		async <Data,>(namespace: MoonrakerNamespaces, key: unknown): Promise<Data | null> => {
			await isReady();
			try {
				const result = await moonrakerQuery('server.database.get_item', {
					namespace: namespace,
					key,
				});
				return result.value as Data;
			} catch (e) {
				console.log(e);
				return null;
			}
		},
		[moonrakerQuery, isReady],
	);

	useEffect(() => {
		if (readyState === 1) {
			(async () => {
				await migrateToLatest();
				onReadyCallbacks.current.forEach((cb) => cb.resolve());
				onReadyCallbacks.current = [];
				setMoonrakerStatus('connected');
			})();
		} else {
			setMoonrakerStatus('connecting');
		}
	}, [readyState]);

	useEffect(() => {
		if (lastJsonMessage?.id && inFlightRequests.current[lastJsonMessage.id]) {
			window.clearTimeout(inFlightRequestTimeouts.current[lastJsonMessage.id]);
			inFlightRequests.current[lastJsonMessage.id](null, lastJsonMessage.result);
			delete inFlightRequestTimeouts.current[lastJsonMessage.id];
			delete inFlightRequests.current[lastJsonMessage.id];
		} else {
			setMoonrakerMessage(lastJsonMessage);
		}
	}, [lastJsonMessage]);

	useEffect(() => {
		return () => {
			for (const reqId in inFlightRequestTimeouts.current) {
				// eslint-disable-next-line react-hooks/exhaustive-deps
				delete inFlightRequestTimeouts.current[reqId];
				// eslint-disable-next-line react-hooks/exhaustive-deps
				delete inFlightRequests.current[reqId];
			}
			onReadyCallbacks.current.forEach((cb) => cb.reject());
			onReadyCallbacks.current = [];
		};
	}, []);

	return {
		query: moonrakerQuery,
		saveItem,
		getItem,
		status: moonrakerStatus,
		lastMessage: moonrakerMessage,
		isReady: readyState === 1,
	};
};

export const useNamespacedQuery = <
	N extends MoonrakerNamespaces,
	K extends MoonrakerNamespaceKeys<N>,
	V extends MoonrakerDBValue<N, K>,
>(
	namespace: N,
	key: K,
	options?: Omit<UseQueryOptions<V, unknown, V, N[]>, 'queryKey' | 'queryFn'>,
) => {
	const { getItem } = useMoonraker();
	return useQuery({
		...options,
		queryKey: [namespace, key],
		queryFn: async () => {
			return getItem(namespace, key) as Promise<V>;
		},
	});
};

export const useNamespacedMutation = <
	N extends MoonrakerNamespaces,
	K extends MoonrakerNamespaceKeys<N>,
	V extends MoonrakerDBValue<N, K>,
>(
	namespace: N,
	key: K,
	value: V,
	options?: Omit<
		UseMutationOptions<MoonrakerDBItemResponse<V>, unknown, MoonrakerDBItemResponse<V>>,
		'mutationKey' | 'mutationFn'
	>,
) => {
	const { saveItem } = useMoonraker();
	return useMutation({
		...options,
		mutationKey: [namespace, key],
		mutationFn: () => saveItem(namespace, key, value) as Promise<MoonrakerDBItemResponse<V>>,
	});
};