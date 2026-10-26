/**
 * @description 旧公共名称的兼容导出；Pod 生产代码使用目录包校验名称。
 */
export { DirectoryPackageManifestValidator as CpmManifestValidator } from './directory-package-manifest-validator.js';
export type {
    IDirectoryPackageManifestInput as ICpmPackageManifestInput,
    IDirectoryPackageManifestValidationResult as ICpmManifestValidationResult,
} from './directory-package-manifest-validator.js';
