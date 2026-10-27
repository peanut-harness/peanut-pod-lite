import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/**
 * Resolve the original isolated fixture or one of the two exact 0.2.1 projects.
 */
export class ComponentMatrixScope {
    public static locate(root: string, input: string) {
        const project = realpathSync(input);
        const isolatedOutput = dirname(project);
        if (project.startsWith(`${root}${sep}evidence${sep}task-5.1${sep}`)
            && project === join(isolatedOutput, 'project'))
            return { project, output: isolatedOutput, mode: 'isolated' as const };
        const workspace = realpathSync(join(root, '../../..'));
        for (const version of ['3.8.3', '3.8.7'] as const) {
            const expected = join(workspace, `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`);
            if (project !== expected) continue;
            const output = join(root, 'evidence/task-5.1', `full51-existing-20261027-${version}`, 'existing-project-stage');
            const receipt = join(output, 'stage-complete.json');
            const registrationPath = join(output, 'project-ownership.json');
            if (!existsSync(receipt) || !existsSync(registrationPath) || realpathSync(output) !== output)
                throw new Error('component_existing_matrix_stage_or_registration_missing');
            const registration = JSON.parse(readFileSync(registrationPath, 'utf8'));
            if (registration.kind !== 'registered-existing-0.2.1-project' || registration.projectPath !== project
                || registration.creatorVersion !== version || registration.evidenceOutput !== output)
                throw new Error('component_existing_matrix_registration_invalid');
            return { project, output, mode: 'existing' as const };
        }
        throw new Error('component_matrix_project_out_of_scope');
    }
}
