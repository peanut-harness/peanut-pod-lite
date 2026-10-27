import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/**
 * Resolve only a registered isolated fixture or the two exact existing 0.2.1 projects.
 */
export class ComponentSdkCompatScope {
    public static locate(project: string): { output: string; registration: Record<string, unknown> } {
        project = realpathSync(project);
        const local = join(project, 'extensions/peanut-component-probe/project-ownership.json');
        const registration = JSON.parse(readFileSync(existsSync(local) ? local
            : join(dirname(project), 'project-ownership.json'), 'utf8')) as Record<string, unknown>;
        const worktree = realpathSync(String(registration.worktree));
        const version = String(registration.creatorVersion);
        const existing = registration.kind === 'registered-existing-0.2.1-project';
        const output = existing ? String(registration.evidenceOutput) : dirname(project);
        if (registration.task !== '5.1' || registration.projectPath !== project
            || !['3.8.3', '3.8.7'].includes(version) || realpathSync(output) !== output
            || existing && (project !== join(realpathSync(join(worktree, '../../..')),
                `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`)
                || output !== join(worktree, 'evidence/task-5.1', `full51-existing-20261027-${version}`, 'existing-project-stage'))
            || !existing && !project.startsWith(worktree + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_compat_scope_invalid');
        if (existing && !readFileSync(local).equals(readFileSync(join(output, 'project-ownership.json'))))
            throw new Error('component_sdk_compat_registration_diverged');
        return { output, registration };
    }
}
