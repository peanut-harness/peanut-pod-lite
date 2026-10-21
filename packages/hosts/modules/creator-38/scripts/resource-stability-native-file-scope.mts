import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @description Fixed owned-namespace ordinary-file reads; no decoding, execution or semantic authority.
 */
export class ResourceStabilityNativeFileScope {
    /**
     * @description Capture canonical project and exact registered run namespace.
     */
    public constructor(private readonly project: string, private readonly namespace: string) {
        if (realpathSync(project) !== project || !/^assets\/fixtures\/resource-stability\/[a-z0-9][a-z0-9-]{0,95}$/u.test(namespace)) throw new Error('resource_source_scope_invalid');
    }
    /**
     * @description Bounded stable ordinary descriptor read; binary and UTF8 callers remain separate.
     */
    public readFile(path: string): Buffer {
        const file = this.scoped(path); const before = lstatSync(file);
        if (!before.isFile() || before.size > 1024 * 1024) throw new Error('resource_source_file_budget_or_type');
        const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const first = fstatSync(fd); if (first.dev !== before.dev || first.ino !== before.ino || first.size !== before.size) throw new Error('resource_source_fd_changed');
            const bytes = Buffer.alloc(first.size); let offset = 0;
            while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) throw new Error('resource_source_short_read'); offset += n; }
            const last = fstatSync(fd); const after = lstatSync(this.scoped(path));
            if (last.ino !== first.ino || last.dev !== first.dev || last.size !== first.size || last.mtimeMs !== first.mtimeMs || last.ctimeMs !== first.ctimeMs
                || after.ino !== first.ino || after.dev !== first.dev || after.size !== first.size || after.mtimeMs !== first.mtimeMs || after.ctimeMs !== first.ctimeMs) throw new Error('resource_source_read_changed');
            return bytes;
        } finally { closeSync(fd); }
    }

    /**
     * @description Inspect all existing ancestors; no escape or link may reach an unowned file.
     */
    public scoped(path: string): string {
        if (!path.startsWith(this.namespace + '/') || path.length > 512 || /[\\%\u0000-\u001f]/u.test(path)
            || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('resource_source_path_denied');
        let current = this.project;
        for (const part of path.split('/')) { current = join(current, part);
            try { if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('resource_source_symlink'); }
            catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return join(this.project, path); throw error; }
        }
        return current;
    }

}
