import type { IPluginManifest, IPluginPackResult, IPluginPackageMeta } from '@peanut/pod-protocol';
import { PackagingApp } from '@peanut/pod-engine/installation';

/**
 * Owns package validation and local packaging policy for the plugin manager panel.
 */
export class PluginManagerPackageAuthoring {
    public constructor(private readonly _packaging: PackagingApp) {}

    public async pack(sourcePath: string, manifest: IPluginManifest, packageMeta?: IPluginPackageMeta): Promise<IPluginPackResult> {
        if (!this._packaging.hasProjectPackageStore()) return this._packaging.pack(sourcePath, manifest, packageMeta);
        const validation = await this._packaging.validate(sourcePath);
        if (!validation.ok) throw new Error(`plugin_package_invalid:${validation.issues.join(',')}`);
        const packageManifest = manifest.package;
        if (packageManifest == null) throw new Error('plugin_package_metadata_missing');
        return {
            sourcePath,
            packagePath: sourcePath,
            packageMeta: packageMeta ?? {
                digest: packageManifest.digest,
                packedAt: packageManifest.packedAt,
                sdkVersion: packageManifest.sdkVersion,
                ...(packageManifest.signature == null ? {} : { signature: packageManifest.signature }),
            },
        };
    }

    public validate(packagePath: string) {
        return this._packaging.validate(packagePath);
    }
}
