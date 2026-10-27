import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentLifecycleFixture } from './component-lifecycle-fixture.mts';
import { ComponentPresentationFixture } from './component-presentation-fixture.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';
import { ComponentNativeFieldContract } from './component-native-field-contract.mts';
import { ComponentSkinnedHierarchy } from './component-skinned-hierarchy.mts';
import type { IComponentSkinnedContext } from './component-skinned-hierarchy.mts';

type Version = '3.8.3' | '3.8.7';
const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const workspace = resolve(root, '../../..');
const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

function safeProjectFile(project: string, relative: string): string {
    if (!relative.startsWith('assets/components/_lifecycle/task51-') || relative.startsWith('/')
        || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
        throw new Error('component_existing_runstage_path_invalid');
    const full = resolve(project, relative);
    if (!full.startsWith(project + sep)) throw new Error('component_existing_runstage_path_escape');
    return full;
}

export class ComponentExistingMatrixRunstage {
    /**
     * @description 规划现存空附件的owner交接；不持有文件写权，不撤销或转移已有能力授权。
     * @param project 已登记工程根。
     * @param owner 当前工作树登记所有者。
     * @param before 现存附件清单原始字节。
     * @returns 精确前像摘要和迁移后字节；原owner仍有能力时拒绝自动交接。
     */
    public static attachmentHandoff(project: string, owner: string, before: Buffer) {
        const value: unknown = JSON.parse(before.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('component_existing_attachment_record_invalid');
        const record = Object.fromEntries(Object.entries(value));
        if (Object.keys(record).sort().join(',') !== 'capabilities,owner,projectPath,resourceRoots,schemaVersion'
            || record.schemaVersion !== 1 || record.projectPath !== project
            || typeof record.owner !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(record.owner)
            || !/^[A-Za-z0-9._:-]{1,128}$/u.test(owner)
            || !Array.isArray(record.capabilities) || record.capabilities.some(name => typeof name !== 'string')
            || JSON.stringify(record.resourceRoots) !== JSON.stringify(['assets/components', 'assets/fixtures']))
            throw new Error('component_existing_attachment_scope_invalid');
        const required = record.owner !== owner;
        if (required && record.capabilities.length > 0) throw new Error('component_existing_attachment_live_grants_require_revocation');
        return { required, beforeSha256: digest(before), previousOwner: record.owner, owner,
            afterBytes: required ? Buffer.from(JSON.stringify({ ...record, owner }, null, 2) + '\n') : Buffer.from(before) };
    }

    /**
     * @description 为现有工程准备全分母的新路径写集；蒙皮上下文只用于离线计划，不能由旧stage入口部分执行。
     * @param version 精确版本。
     * @param campaign 全新且未暂存的矩阵标识。
     * @param actor 当前登记所有者。
     * @param skinnedContext 已核验现有资源身份的同源模板。
     * @returns 未写入工程的候选、字段契约和精确场景写集。
     */
    public static prepare(version: Version, campaign: string, actor = process.env.CODEX_THREAD_ID ?? '',
        skinnedContext: IComponentSkinnedContext | null = null) {
        if (!['3.8.3', '3.8.7'].includes(version) || !/^task51-attempt-[0-9]{2}$/u.test(campaign))
            throw new Error('component_existing_runstage_identity_invalid');
        const owner = ComponentTaskOwnership.current(root, actor);
        const project = join(workspace, `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`);
        const output = join(root, 'evidence/task-5.1', `full51-existing-20261027-${version}`, 'existing-project-stage');
        if (realpathSync(project) !== project || realpathSync(output) !== output
            || !existsSync(join(output, 'stage-complete.json'))
            || !existsSync(join(project, 'extensions/peanut-component-probe/package.json')))
            throw new Error('component_existing_runstage_scope_invalid');
        const processes = execFileSync('/bin/ps', ['-axo', 'args=', '-ww'], { encoding: 'utf8' });
        if (processes.split('\n').some(line => line.includes(`--project ${project}`)))
            throw new Error('component_existing_runstage_project_occupied');
        const attachmentPath = join(project, '.peanut-ai/cocos-mcp-attachments.json');
        const attachmentStat = lstatSync(attachmentPath, { throwIfNoEntry: false });
        if (attachmentStat && (!attachmentStat.isFile() || realpathSync(attachmentPath) !== attachmentPath))
            throw new Error('component_existing_attachment_path_invalid');
        const attachmentHandoff = existsSync(attachmentPath)
            ? { path: attachmentPath, ...this.attachmentHandoff(project, owner, readFileSync(attachmentPath)) } : null;
        const engine = `/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/engine`;
        if (skinnedContext) {
            const existing = ComponentSkinnedHierarchy.prepareExisting(root, project, engine, version);
            const template = realpathSync(skinnedContext.templatePath);
            if (template !== skinnedContext.templatePath || !template.startsWith(join(root, 'evidence/task-5.1/takeover-20261027') + sep)
                || skinnedContext.sourceUuid !== existing.sourceUuid
                || !readFileSync(template).equals(existing.templateBytes))
                throw new Error('component_existing_runstage_skinned_template_mismatch');
        }
        const audit = ComponentCatalogAudit.create(root, engine, version);
        const fields = ComponentFieldFixtures.create(root, version, audit.nativeDeclarations, skinnedContext !== null);
        if (fields.componentCount !== 99 || fields.fieldCount !== 795 || fields.components.length !== 99)
            throw new Error('component_existing_runstage_denominator_invalid');
        const targetRows: Record<string, unknown>[] = [];
        const planned: { path: string; bytes: Buffer; kind: 'lifecycle' | 'presentation'; document?: LumenPrefabDocument }[] = [];
        const runRoot = `assets/components/_lifecycle/${campaign}`;
        for (const field of fields.components) {
            const assembled = ComponentSceneFixture.create(root, version, field, audit.nativeDeclarations, true, skinnedContext);
            if (assembled.status === 'blocked') {
                targetRows.push({ componentType: field.componentType, status: 'blocked', blockers: assembled.blockers,
                    fieldStates: field.cases.map(item => ({ id: item.id, status: 'component-precondition-blocked' })),
                    presentation: { status: 'presentation-context-pending', scenePath: null, stagedSha256: null } });
                continue;
            }
            const lifecyclePath = `${runRoot}/${field.componentType}.scene`;
            const lifecycle = ComponentLifecycleFixture.create(assembled.document, version, field.componentType, lifecyclePath);
            const lifecycleBytes = Buffer.from(JSON.stringify([...lifecycle.entries], null, 2) + '\n');
            planned.push({ path: lifecyclePath, bytes: lifecycleBytes, kind: 'lifecycle' });
            const presentation = ComponentPresentationFixture.create(engine, version, field, false, skinnedContext);
            let presentationRecord: Record<string, unknown>;
            if (presentation.status === 'authored-presentation-native-pending') {
                const presentationPath = `${runRoot}/presentations/${field.componentType}.scene`;
                const document = new LumenPrefabDocument(presentationPath, structuredClone([...presentation.document.entries]),
                    new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
                planned.push({ path: presentationPath, bytes: Buffer.alloc(0), kind: 'presentation', document });
                presentationRecord = { status: presentation.status, scenePath: presentationPath, stagedSha256: null };
            } else presentationRecord = { status: presentation.status, scenePath: null, stagedSha256: null };
            targetRows.push({ componentType: field.componentType, status: assembled.status,
                pendingRequirements: assembled.pendingRequirements, targetPath: assembled.targetPath,
                nodePaths: assembled.nodePaths, scenePath: lifecyclePath,
                stagedSha256: digest(lifecycleBytes), fieldStates: assembled.fieldStates,
                presentation: presentationRecord });
        }
        if (targetRows.length !== 99 || targetRows.reduce((sum, row) => sum +
            (fields.components.find(item => item.componentType === row.componentType)?.cases.length ?? 0), 0) !== 795)
            throw new Error('component_existing_runstage_denominator_invalid');
        const stagingPath = join(output, 'component-matrix-staging.json');
        const preservedInputPath = join(output, `${campaign}-previous-staging.json`);
        const receiptPath = join(output, `${campaign}-runstage-receipt.json`);
        if (existsSync(preservedInputPath) || existsSync(receiptPath)) throw new Error('component_existing_runstage_already_prepared');
        for (const item of planned) for (const relative of [item.path, ...(item.kind === 'presentation' ? [`${item.path}.meta`] : [])])
            if (existsSync(safeProjectFile(project, relative))) throw new Error(`component_existing_runstage_target_exists:${relative}`);
        if (targetRows.some(row => row.status !== 'blocked' && (typeof row.scenePath !== 'string'
            || !String(row.scenePath).startsWith(`${runRoot}/`)))) throw new Error('component_existing_runstage_row_invalid');
        const candidate = { creatorVersion: version, componentCount: 99, fieldCount: 795, nativePassedRows: 0,
            campaign, rows: targetRows };
        return { owner, project, output, stagingPath, preservedInputPath, receiptPath, version, campaign,
            attachmentHandoff,
            publicFieldContract: ComponentNativeFieldContract.create(root, engine, fields, audit.nativeDeclarations),
            planned, candidate, assembledComponents: targetRows.filter(row => row.status !== 'blocked').length,
            blockedComponents: targetRows.filter(row => row.status === 'blocked').length };
    }

    public static stage(version: Version, campaign: string, actor = process.env.CODEX_THREAD_ID ?? '') {
        const plan = this.prepare(version, campaign, actor);
        if (plan.attachmentHandoff?.required) throw new Error('component_existing_runstage_attachment_handoff_required');
        const original = readFileSync(plan.stagingPath);
        const created: string[] = [];
        try {
            for (const item of plan.planned) {
                const target = safeProjectFile(plan.project, item.path);
                mkdirSync(dirname(target), { recursive: true });
                if (item.kind === 'lifecycle') {
                    writeFileSync(target, item.bytes, { flag: 'wx' });
                    created.push(target);
                } else {
                    if (!item.document) throw new Error('component_existing_runstage_presentation_missing');
                    ComponentPresentationFixture.saveForNativeImport(item.document, plan.project, plan.version);
                    created.push(target, `${target}.meta`);
                    const row = plan.candidate.rows.find((entry: Record<string, unknown>) =>
                        (entry.presentation as Record<string, unknown>).scenePath === item.path);
                    if (!row) throw new Error('component_existing_runstage_presentation_row_missing');
                    (row.presentation as Record<string, unknown>).stagedSha256 = digest(readFileSync(target));
                }
            }
        } catch (error) {
            for (const path of created) rmSync(path, { force: true });
            throw error;
        }
        writeFileSync(plan.preservedInputPath, original, { flag: 'wx' });
        const temporary = `${plan.stagingPath}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(plan.candidate, null, 2) + '\n', { flag: 'wx' });
        renameSync(temporary, plan.stagingPath);
        writeFileSync(plan.receiptPath, JSON.stringify({ schema: 'peanut.component-existing-matrix-runstage.v1',
            owner: plan.owner, project: plan.project, creatorVersion: version, campaign,
            preservedInputSha256: digest(original), assembledComponents: plan.assembledComponents,
            blockedComponents: plan.blockedComponents, nativePassedRows: 0,
            files: plan.planned.map(item => ({ path: item.path, kind: item.kind, sha256: digest(item.bytes) })),
            at: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
        return { creatorVersion: version, campaign, assembledComponents: plan.assembledComponents,
            blockedComponents: plan.blockedComponents, componentCount: 99, fieldCount: 795,
            nativePassedRows: 0, receiptPath: plan.receiptPath };
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, version, campaign] = process.argv.slice(2);
    if (!['plan', 'stage'].includes(mode ?? '') || !['3.8.3', '3.8.7'].includes(version ?? '')
        || !/^task51-attempt-[0-9]{2}$/u.test(campaign ?? '') || process.argv.length !== 5)
        throw new Error('component_existing_runstage_arguments_invalid');
    const result = mode === 'plan'
        ? (() => { const { planned, candidate: _candidate, publicFieldContract: _contract, ...summary } = ComponentExistingMatrixRunstage.prepare(version as Version, campaign as string); return { ...summary, fileCount: planned.length }; })()
        : ComponentExistingMatrixRunstage.stage(version as Version, campaign as string);
    process.stdout.write(JSON.stringify(result) + '\n');
}
