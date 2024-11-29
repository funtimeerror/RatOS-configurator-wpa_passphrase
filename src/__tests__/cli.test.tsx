import { afterEach, beforeEach, describe, expect, test, vi, Mock } from 'vitest';
import { render } from 'ink-testing-library';
import { createTRPCProxyClient } from '@trpc/client';
import { readPackageUp } from 'read-package-up';
import { $ } from 'zx';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@trpc/client');
vi.mock('read-package-up');
vi.mock('zx');
const mockedRender = vi.fn().mockImplementation(render);
vi.mock('ink', async () => ({
	...(await vi.importActual('ink')),
	render: mockedRender,
}));
vi.mock('@/cli/util.tsx', async () => ({
	...(await vi.importActual('@/cli/util.tsx')),
	renderError: vi.fn().mockImplementation((error: string, options: { exitCode: number }) => {
		// eslint-disable-next-line no-console
		console.trace('RenderError Mock:', error, options);
		throw new Error(error);
	}),
	getRealPath: vi.fn().mockImplementation(async (program: Command, p: string) => {
		return p;
	}),
}));
vi.mock('@/utils/trpc.js', () => ({
	getBaseUrl: () => 'http://localhost:3000',
}));

// Mock the file system to simulate stat of ./test.py
vi.mock('node:fs/promises', async () => ({
	...(await vi.importActual('node:fs/promises')),
	stat: vi.fn().mockResolvedValue({
		isFile: () => {
			return true;
		},
	}),
}));

describe('RatOS CLI', () => {
	const mockTrpcClient = {
		osVersion: { query: vi.fn<any, Promise<string>>() },
		version: { query: vi.fn<any, Promise<string>>() },
		klipperVersion: { query: vi.fn<any, Promise<string>>() },
		ipAddress: { query: vi.fn<any, Promise<string>>() },
		'klippy-extensions': {
			list: { query: vi.fn<any, Promise<any>>() },
			register: { mutate: vi.fn<any, Promise<any>>() },
			unregister: { mutate: vi.fn<any, Promise<any>>() },
			symlink: { mutate: vi.fn<any, Promise<any>>() },
		},
		'moonraker-extensions': {
			list: { query: vi.fn<any, Promise<any>>() },
			register: { mutate: vi.fn<any, Promise<any>>() },
			unregister: { mutate: vi.fn<any, Promise<any>>() },
			symlink: { mutate: vi.fn<any, Promise<any>>() },
		},
		printer: {
			regenerateConfiguration: { mutate: vi.fn<any, Promise<any>>() },
		},
		mcu: {
			flashAllConnected: { mutate: vi.fn<any, Promise<any>>() },
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(createTRPCProxyClient as Mock).mockReturnValue(mockTrpcClient);
		(
			readPackageUp as unknown as Mock<Parameters<typeof readPackageUp>, ReturnType<typeof readPackageUp>>
		).mockResolvedValue({
			packageJson: { version: '1.0.0' },
			path: '',
		});
		vi.resetModules();
	});

	describe('info command', () => {
		test('should display system information', async () => {
			// Setup mock responses
			mockTrpcClient.osVersion.query.mockResolvedValue('RatOS 2.0');
			mockTrpcClient.version.query.mockResolvedValue('1.0.0');
			mockTrpcClient.klipperVersion.query.mockResolvedValue('v0.11.0');
			mockTrpcClient.ipAddress.query.mockResolvedValue('192.168.1.100');

			// Execute command
			process.argv = ['node', 'ratos', 'info'];
			await import('@/cli/ratos');

			// Verify render was called with correct component
			expect(mockedRender).toHaveBeenCalled();
		});
	});

	describe('extensions commands', () => {
		test('should list registered extensions', async () => {
			// Setup mock responses
			mockTrpcClient['klippy-extensions'].list.query.mockResolvedValue([
				{ extensionName: 'test', path: '/path/to/', fileName: 'test.py' },
			]);
			mockTrpcClient['moonraker-extensions'].list.query.mockResolvedValue([]);

			// Execute command
			process.argv = ['node', 'ratos', 'extensions', 'list'];
			await import('@/cli/ratos');

			// Verify render was called
			expect(mockedRender).toHaveBeenCalled();
		});

		test('should register klipper extension', async () => {
			mockTrpcClient['klippy-extensions'].register.mutate.mockResolvedValue({
				message: 'Successfully registered',
				result: 'success',
			});

			process.argv = ['node', 'ratos', 'extensions', 'register', 'klipper', 'test', './test.py'];
			await import('@/cli/ratos');
			expect(mockTrpcClient['klippy-extensions'].register.mutate).toHaveBeenCalled();
		});
	});

	describe('config commands', () => {
		test('should regenerate configuration', async () => {
			mockTrpcClient.printer.regenerateConfiguration.mutate.mockResolvedValue([
				{ action: 'created', fileName: 'printer.cfg' },
			]);

			process.argv = ['node', 'ratos', 'config', 'regenerate'];
			await import('@/cli/ratos');

			expect(mockTrpcClient.printer.regenerateConfiguration.mutate).toHaveBeenCalled();
		});
	});

	describe('doctor command', () => {
		test('should run diagnostic and repair steps', async () => {
			const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
			($ as unknown as Mock).mockReturnValue(mockExec);

			process.argv = ['node', 'ratos', 'doctor'];
			await import('@/cli/ratos');

			expect(mockExec).toHaveBeenCalled();
		});
	});
});
