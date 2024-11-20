import { $, echo, path, tempfile, which, Shell, Options } from 'zx';
import { getLogger } from '@/cli/logger.js';
import { createSignal } from '@/app/_helpers/signal.ts';
import { searchFileByLine } from '@/server/helpers/file-operations.ts';
import { appendFile, rm, lstat, unlink, writeFile } from 'fs/promises';
import { existsSync, stat } from 'fs';
import { ensureSudo } from '@/cli/util.tsx';

export function report_status(statusText: string) {
	echo(`\n\n###### ${statusText}`);
}

export async function update_npm($$: Shell = $) {
	report_status('Updating npm...');
	return $$`npm install -g npm`;
}

export async function update_pnpm($$: Shell = $) {
	report_status('Updating pnpm...');
	return $$`npm install -g pnpm`;
}

export async function pnpm_install($$: Shell = $) {
	report_status('Performing pnpm install...');
	return $$`pnpm install --frozen-lockfile --aggregate-output --no-color --config.confirmModulesPurge=false`;
}

export async function ensure_pnpm_installation($$: Shell = $) {
	const whichPnpm = await which('pnpm', { nothrow: true });
	if (whichPnpm === null) {
		report_status('Installing pnpm');
		await $$`npm install -g pnpm`;
		await rm('node_modules', { recursive: true, force: true });
		await pnpm_install();
	}
}

export async function ensure_service_permission() {
	const dataDir = process.env.PRINTER_DATA_DIR ?? '/home/pi/printer_data';
	const moonrakerASvcPath = path.join(dataDir, 'moonraker.asvc');
	searchFileByLine(moonrakerASvcPath, 'ratos-configurator').then((result) => {
		if (result === false) {
			report_status('Updating service permissions');
			return appendFile(moonrakerASvcPath, '\nratos-configurator');
		}
	});
}
export async function build($$: Shell = $) {
	return $$`pnpm build`;
}

export async function install_git_hook(gitDir: string, gitHook: string, commands: string) {
	report_status('Installing git hook');
	//if older symlink to shell script exists, remove it
	const hookPath = path.join(gitDir, gitHook);
	if (existsSync(hookPath)) {
		const stats = await lstat(hookPath);
		if (stats.isSymbolicLink()) {
			unlink(hookPath);
		}
	}
	await writeFile(hookPath, commands, 'utf-8');
}

export async function install_logrotation($$: Shell = $) {
	await ensureSudo();
	const logRotateFile = '/etc/logrotate.d/ratos-configurator';
	const logRotateFileContent = `
#### RatOS-configurator
####
#### Written by Mikkel Schmidt <mikkel.schmidt@gmail.com>
#### Copyright 2022
#### https://github.com/Rat-OS/RatOS-Configurator
####
#### This File is distributed under GPLv3
####


${process.env.LOG_FILE} {
    rotate 3
    missingok
    notifempty
    copy
    daily
    dateext
    dateformat .%Y-%m-%d
    maxsize 10M
}
`;
	const tmpFile = tempfile();
	await writeFile(logRotateFile, tmpFile, 'utf-8');
	await $$`sudo mv ${tmpFile} ${logRotateFile}`;
	await $$`sudo chmod 0664 ${logRotateFile}`;
}

export async function patch_log_rotation($$: Shell = $) {
	await ensureSudo();
	const logRotateFile = '/etc/logrotate.d/ratos-configurator';
	if (existsSync(logRotateFile)) {
		const needsPatch = await searchFileByLine(logRotateFile, '/printer_data/logs/configurator.log');
		if (needsPatch !== false) {
			report_status('Patching log rotation');
			await $$`sudo sed -i 's|rotate 4|rotate 3|g' ${logRotateFile}`;
			await $$`sudo sed -i 's|/printer_data/logs/configurator.log"|/printer_data/logs/ratos-configurator.log"|g' ${logRotateFile}`;
		}
	} else {
		await install_logrotation();
	}
}
export async function install_cli($$: Shell = $) {
	const cliPath = '/usr/local/bin/ratos';
	const cliSrcPath = path.join(process.env.RATOS_CONFIGURATOR_DIR ?? '/home/pi/ratos-configurator', '/bin/ratos');
	await ensureSudo();
	if (!existsSync(cliPath)) {
		await $$`sudo ln -s ${cliSrcPath} ${cliPath}`;
		await $$`sudo chmod a+x ${cliPath}`;
	}
}
export async function verify_users($$: Shell = $) {
	return await $$`id -u pi`;
}
export async function install_udev_rule($$: Shell = $, uDevRulePath: string) {
	const fileName = path.basename(uDevRulePath);
	const dstUDevRulePath = path.join('/etc/udev/rules.d/', fileName);
	report_status('Installing udev rule');
	await ensureSudo();
	if (!existsSync(uDevRulePath)) {
		await $$`sudo ln -s ${uDevRulePath} ${dstUDevRulePath}`;
	}
}
export async function ensure_sudo_command_whitelisting() {
	await ensureSudo();
    report_status("Updating whitelisted commands");
	//Whitelist RatOS configurator git hook scripts
	//if [[ -e /etc/sudoers.d/030-ratos-configurator-githooks ]]
	//then
	//	$sudo rm /etc/sudoers.d/030-ratos-configurator-githooks
	//fi

	const legacyRatosConfiguratorGithooksSudoersFile = '/etc/sudoers.d/030-ratos-configurator-githooks';
	const allowLegacyRatosConfiguratorGithooksSudoersContent = `
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/update.sh
`;

	const tmpFile = tempfile();
	await writeFile(logRotateFile, tmpFile, 'utf-8');
	await $$`sudo mv ${tmpFile} ${logRotateFile}`;
	await $$`sudo chmod 0664 ${logRotateFile}`;

	$sudo chown root:root /tmp/030-ratos-configurator-githooks
	$sudo chmod 440 /tmp/030-ratos-configurator-githooks
	$sudo cp --preserve=mode /tmp/030-ratos-configurator-githooks /etc/sudoers.d/030-ratos-configurator-githooks

	# Whitelist configurator scripts
	if [[ -e /etc/sudoers.d/030-ratos-configurator-scripts ]]
	then
		$sudo rm /etc/sudoers.d/030-ratos-configurator-scripts
	fi
	touch /tmp/030-ratos-configurator-scripts
	cat << __EOF > /tmp/031-ratos-configurator-scripts
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/add-wifi-network.sh
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/change-hostname.sh
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/dfu-flash.sh
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/board-script.sh
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/flash-path.sh
pi  ALL=(ALL) NOPASSWD: $SCRIPT_DIR/klipper-compile.sh
__EOF

	$sudo chown root:root /tmp/031-ratos-configurator-scripts
	$sudo chmod 440 /tmp/031-ratos-configurator-scripts
	$sudo cp --preserve=mode /tmp/031-ratos-configurator-scripts /etc/sudoers.d/031-ratos-configurator-scripts

	# Whitelist configurator commands
	if [[ -e /etc/sudoers.d/031-ratos-configurator-wifi ]]
	then
		$sudo rm /etc/sudoers.d/031-ratos-configurator-wifi
	fi
	touch /tmp/031-ratos-configurator-wifi
	cat << __EOF > /tmp/031-ratos-configurator-wifi
pi  ALL=(ALL) NOPASSWD: /usr/sbin/iw
pi  ALL=(ALL) NOPASSWD: /usr/sbin/wpa_cli
__EOF

	$sudo chown root:root /tmp/031-ratos-configurator-wifi
	$sudo chmod 440 /tmp/031-ratos-configurator-wifi
	$sudo cp --preserve=mode /tmp/031-ratos-configurator-wifi /etc/sudoers.d/031-ratos-configurator-wifi

}
