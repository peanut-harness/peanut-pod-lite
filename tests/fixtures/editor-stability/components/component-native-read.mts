import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

/**
 * @description 每次重读令牌与端口，并把原生响应绑定到登记工程及本任务实际启动进程。
 */
class ComponentNativeRead {
    /**
     * @description 获取有归属和候选身份的健康信息，不输出认证描述符。
     */
    public static async run(project: string): Promise<void> {
        const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
        project = realpathSync(project); const output = dirname(project);
        if (!project.startsWith(`${root}${sep}evidence${sep}task-5.1${sep}`)) throw new Error('component_native_read_project_out_of_scope');
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        const lease = JSON.parse(readFileSync(join(output, 'creator-owned-start.json'), 'utf8'));
        const request = async (action: string, input: Record<string, unknown> = {}): Promise<unknown> => {
            const descriptorPath = join(project, '.peanut-ai/component-probe.json');
            if (realpathSync(descriptorPath) !== descriptorPath) throw new Error('component_native_descriptor_link');
            const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
            if (descriptor.projectPath !== project || descriptor.owner !== registration.owner || descriptor.pid !== lease.pid
                || descriptor.runId !== registration.runId || !Number.isInteger(descriptor.port)) throw new Error('component_native_descriptor_identity_mismatch');
            const current = execFileSync('/bin/ps', ['-p', String(lease.pid), '-o', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8' }).trim();
            if (current !== lease.identity.trim()) throw new Error('component_native_owned_process_changed');
            const response = await fetch(`http://127.0.0.1:${descriptor.port}/probe`, {
                method: 'POST', headers: { 'content-type': 'application/json', 'x-component-token': descriptor.token },
                body: JSON.stringify({ action, ...input }), signal: AbortSignal.timeout(30000),
            });
            const body = await response.json();
            if (!response.ok || body.ok !== true) throw new Error(body.error ?? 'component_native_request_failed');
            return body.result;
        };
        const until = Date.now() + 90000;
        while (!existsSync(join(project, '.peanut-ai/component-probe.json'))) {
            if (Date.now() >= until) throw new Error('component_native_probe_not_loaded');
            await new Promise((done) => setTimeout(done, 1000));
        }
        type Health = { host: { ready: boolean; artifacts: unknown }; creatorVersion: string; pid: number; localProfiles: unknown };
        let health: Health | null = null;
        const hostUntil = Date.now() + 120000;
        const startupObservations: unknown[] = [];
        do {
            try {
                const queried = await request('health') as Health;
                if (queried.host.ready) { health = queried; break; }
                startupObservations.push({ at: new Date().toISOString(), hostReady: false });
            } catch (error) {
                if (!(error instanceof Error) || error.message !== 'Message does not exist: peanut-pod-lite-host - query-status') throw error;
                startupObservations.push({ at: new Date().toISOString(), error: error.message });
            }
            writeFileSync(join(output, 'native-startup-observations.json'), JSON.stringify(startupObservations, null, 2) + '\n');
            if (Date.now() >= hostUntil) throw new Error('component_native_host_not_ready');
            await new Promise((done) => setTimeout(done, 1000));
        } while (true);
        if (!health) throw new Error('component_native_health_missing');
        writeFileSync(join(output, 'native-health.json'), JSON.stringify(health, null, 2) + '\n', { mode: 0o600 });
        const { CpmPackageStore } = createRequire(import.meta.url)('../../../../packages/hosts/modules/creator-38/src/cpm-package-store.js');
        const descriptor = JSON.parse(readFileSync(join(root, 'release/peanut.pod-lite-0.2.0/lite-release-descriptor.json'), 'utf8'));
        const identityErrors = CpmPackageStore.compareReleaseIdentity(health.host.artifacts, descriptor);
        if (!health.host.ready || health.creatorVersion !== registration.creatorVersion || health.pid !== lease.pid || identityErrors.length)
            throw new Error(`component_native_health_or_candidate_failed:${JSON.stringify(identityErrors)}`);
        const staging = JSON.parse(readFileSync(join(output, 'staging-receipt.json'), 'utf8')) as {
            bindings: Record<string, { sources: { path: string }[] }>;
        };
        type AssetInfo = { uuid: string; type: string; url: string; imported: boolean; invalid: boolean };
        let assets: AssetInfo[] = [];
        const importedUntil = Date.now() + 120000;
        do {
            const queried = await request('assets');
            if (!Array.isArray(queried)) throw new Error('component_native_asset_query_shape_invalid');
            assets = queried as AssetInfo[];
            if (Object.keys(staging.bindings).every((type) => assets.some((asset) => asset.type === type && asset.imported && !asset.invalid))) break;
            if (Date.now() >= importedUntil) break;
            await new Promise((done) => setTimeout(done, 1000));
        } while (true);
        writeFileSync(join(output, 'native-assets.json'), JSON.stringify(assets, null, 2) + '\n');
        const rows: unknown[] = [];
        for (const [type, binding] of Object.entries(staging.bindings)) {
            const urls = binding.sources.filter((source) => !source.path.endsWith('.meta')).map((source) =>
                `db://assets/fixtures/${source.path.replace('tests/fixtures/editor-stability/', '')}`);
            const candidates = assets.filter((asset) => asset.type === type && asset.imported && !asset.invalid
                && urls.some((url) => asset.url === url || asset.url.startsWith(`${url}/`)));
            const candidate = candidates[0];
            if (!candidate) { rows.push({ type, status: 'blocked', reason: '实际已导入资源中缺少与声明源匹配的类型', candidates }); continue; }
            try {
                const loaded = await request('load-asset', { uuid: candidate.uuid }) as {
                    info: AssetInfo; native: { type: string; actualUuid: string; valid: boolean };
                };
                if (loaded.info.uuid !== candidate.uuid || loaded.native.actualUuid !== candidate.uuid
                    || loaded.native.type !== type || !loaded.native.valid) throw new Error('component_native_asset_identity_or_type_mismatch');
                rows.push({ type, status: 'native-loaded', candidateCount: candidates.length, loaded });
            } catch (error) {
                rows.push({ type, status: 'failed', uuid: candidate.uuid, error: error instanceof Error ? error.message : String(error) });
            }
            writeFileSync(join(output, 'native-resource-loads.json'), JSON.stringify({ creatorVersion: health.creatorVersion, pid: lease.pid, rows }, null, 2) + '\n');
        }
        const snapshot = await request('scene-snapshot');
        writeFileSync(join(output, 'native-backend-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
        process.stdout.write(JSON.stringify({ project, pid: lease.pid, creatorVersion: health.creatorVersion,
            hostReady: health.host.ready, candidateMatched: true, localProfilesRead: health.localProfiles != null,
            assetCount: assets.length, resourceTypes: rows.length,
            nativeLoadedTypes: rows.filter((row) => (row as { status: string }).status === 'native-loaded').length,
            nativePassedRows: 0 }) + '\n');
    }
}

const project = process.argv[process.argv.indexOf('--project') + 1];
if (!project) throw new Error('component_native_read_project_required');
await ComponentNativeRead.run(project);
