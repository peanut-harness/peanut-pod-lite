import type { IProjectRevisionSnapshot } from '@peanut/pod-protocol';

/** @description 会使工程观察结果失效的稳定边界。 */
export type ProjectRevisionBoundary = 'write_started' | 'write_finished' | 'refresh_settled' | 'external_change';

/**
 * @description 单工程单调 revision 时钟；不保存资源路径、操作输入或变更内容。
 */
export class ProjectRevisionClock {
    private readonly _projectKey: string;
    private readonly _now: () => number;
    private _revision = 0;
    private _lastBoundary: ProjectRevisionBoundary | null = null;

    public constructor(projectKey: string, now: () => number = Date.now) {
        if (projectKey.trim().length === 0) {
            throw new Error('project_revision_key_invalid');
        }
        this._projectKey = projectKey;
        this._now = now;
    }

    /** @description 在可观察边界推进 revision，并返回新快照。 */
    public advance(boundary: ProjectRevisionBoundary): IProjectRevisionSnapshot {
        if (this._revision >= Number.MAX_SAFE_INTEGER) {
            throw new Error('project_revision_exhausted');
        }
        this._revision += 1;
        this._lastBoundary = boundary;
        return this.snapshot();
    }

    public beginWrite(): IProjectRevisionSnapshot { return this.advance('write_started'); }
    public finishWrite(): IProjectRevisionSnapshot { return this.advance('write_finished'); }
    public refreshSettled(): IProjectRevisionSnapshot { return this.advance('refresh_settled'); }
    public externalChange(): IProjectRevisionSnapshot { return this.advance('external_change'); }

    /** @description 返回当前 revision，stale 表示调用方给定 revision 已经过期。 */
    public snapshot(observedRevision: number = this._revision): IProjectRevisionSnapshot {
        return {
            projectKey: this._projectKey,
            revision: this._revision,
            stale: observedRevision !== this._revision,
            observedAt: new Date(this._now()).toISOString(),
        };
    }

    /** @description 返回最近失效边界，仅供宿主测试与诊断，不含工作内容。 */
    public getLastBoundary(): ProjectRevisionBoundary | null {
        return this._lastBoundary;
    }
}
