import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResourceStabilityNativeProject } from './resource-stability-native-project.mts';
import { ResourceStabilityNativeClient } from './resource-stability-native-client.mts';
import { ResourceStabilityManagedPort } from './resource-stability-managed-port.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan } from './resource-stability-contracts.mts';

const names = ['asset-import', 'asset-copy', 'asset-move', 'asset-rename', 'asset-create-folder', 'asset-delete',
    'asset-reimport', 'asset-open', 'lumen-scaffold', 'lumen-asset-set', 'lumen-node-set', 'lumen-commit']
    .map((name) => `peanut.editor-mcp.${name}`);
const args = process.argv.slice(2);
const argument = (key: string): string => { const index = args.indexOf(key); const value = index < 0 ? undefined : args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`resource_native_argument_missing:${key}`); return value; };
if (args.includes('--prepare')) {
    const project = await ResourceStabilityNativeProject.prepare({
        repository: realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url))), creatorApp: argument('--creator-app'),
        runId: argument('--run-id'), expectedSourceCommit: argument('--source-commit'),
    });
    process.stdout.write(`${project}\n`);
} else if (args.includes('--run')) {
    const client = new ResourceStabilityNativeClient(argument('--project'));
    const path = join(client.output, 'resource-native-shard-result.json');
    const staged = JSON.parse(readFileSync(join(client.output, 'resource-native-staging.json'), 'utf8')) as {
        plan: IResourceCampaignPlan; expected: IResourceCampaignExpectation; fullResourceCaseIds: string[]; blocked: unknown[] };
    let attached = false; let failure: string | null = null; let detachFailure: string | null = null;
    let observations: Awaited<ReturnType<typeof ResourceStabilityRunner.run>> = [];
    let port: ResourceStabilityManagedPort | null = null;
    try {
        client.assertWholeLogs();
        const identity = await client.identity();
        const expected = { ...staged.expected, ...identity };
        await client.mcp({ action: 'attachCapabilities', owner: identity.owner, projectPath: identity.projectPath,
            resourceRoots: [staged.plan.namespace], capabilities: names }); attached = true;
        port = new ResourceStabilityManagedPort(staged.plan, expected, client);
        observations = await ResourceStabilityRunner.run(staged.plan, expected, port);
        client.assertWholeLogs();
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    finally {
        observations = port?.observations ?? observations;
        if (attached) try {
            await client.mcp({ action: 'detachCapabilities', owner: client.registration.owner,
                projectPath: client.project, resourceRoots: [staged.plan.namespace], capabilities: names });
        } catch (error) { detachFailure = error instanceof Error ? error.message : String(error); }
        writeFileSync(path, JSON.stringify({ accepted: false, task43Complete: false, nativeSessionAcceptance: false,
            allEnabled: false, renderedAcceptance: false, creatorStillRequiresOwnedNormalExit: true,
            sourceCommit: client.registration.candidateSourceCommit, creatorVersion: '3.8.3',
            fullResourceCaseIds: staged.fullResourceCaseIds, blocked: staged.blocked,
            selectedRequired: staged.plan.cases.length, selectedObserved: observations.length,
            selectedObservationsVerified: failure === null && detachFailure === null && observations.length === staged.plan.cases.length,
            failure, detachFailure, observations }, null, 2), { flag: 'wx' });
    }
    if (failure || detachFailure) throw new Error(failure ?? String(detachFailure));
    process.stdout.write(`resource_native_partial_observations:${observations.length};task43_complete:false\n`);
} else throw new Error('resource_native_prepare_or_run_required');
