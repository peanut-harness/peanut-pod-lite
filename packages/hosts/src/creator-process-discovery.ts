import { posix, win32 } from 'node:path';

const CREATOR_BINARY_ENVIRONMENT_KEYS = Object.freeze([
    'COCOS_CREATOR_APP',
    'PEANUT_COCOS_CREATOR_BIN',
    'COCOS_CREATOR_PATH',
]);
const CREATOR_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

/**
 * @description 封装 Cocos Creator 主进程识别与默认可执行文件解析，避免引擎模块依赖宿主脚本。
 */
export class CreatorProcessDiscovery {
    /**
     * @description 从平台进程列表文本中解析绑定指定工程的 Creator 主进程 PID。
     * @param processListText `ps` 或 Windows 进程命令行列表文本。
     * @param projectPath 工程绝对或相对路径。
     * @param platform 进程列表所属平台。
     * @returns 去重后的 Creator 主进程 PID。
     */
    public static parseProjectProcessIds(
        processListText: string,
        projectPath: string,
        platform: NodeJS.Platform = process.platform,
    ): readonly number[] {
        const normalizedProjectPath = CreatorProcessDiscovery._normalizeProjectPath(projectPath, platform);
        const processIds = new Set<number>();
        for (const line of processListText.split(/\r?\n/u)) {
            const processMatch = /^\s*(\d+)\s+(.+)$/u.exec(line);
            if (processMatch == null || !CreatorProcessDiscovery._isCreatorMainProcess(processMatch[2])) {
                continue;
            }
            const commandProjectPath = CreatorProcessDiscovery._extractProjectArgument(processMatch[2]);
            if (
                commandProjectPath == null ||
                CreatorProcessDiscovery._normalizeProjectPath(commandProjectPath, platform) !== normalizedProjectPath
            ) {
                continue;
            }
            const processId = Number(processMatch[1]);
            if (Number.isSafeInteger(processId) && processId > 0) {
                processIds.add(processId);
            }
        }
        return Object.freeze([...processIds]);
    }

    /**
     * @description 按宿主平台返回默认 Creator 可执行文件，并按规范优先使用显式环境变量。
     * @param platform Node.js 平台标识。
     * @param environment 当前进程环境变量。
     * @param creatorVersion 需要定位的 Creator 精确版本。
     * @returns 可供宿主启动流程校验的默认可执行文件路径或命令名。
     */
    public static resolveDefaultBinary(
        platform: NodeJS.Platform = process.platform,
        environment: NodeJS.ProcessEnv = process.env,
        creatorVersion = '3.8.7',
    ): string {
        for (const environmentKey of CREATOR_BINARY_ENVIRONMENT_KEYS) {
            const configuredBinary = environment[environmentKey]?.trim();
            if (configuredBinary != null && configuredBinary.length > 0) {
                return configuredBinary;
            }
        }
        if (!CREATOR_VERSION_PATTERN.test(creatorVersion)) {
            throw new Error(`creator_binary_version_invalid:${creatorVersion}`);
        }
        if (platform === 'win32') {
            return win32.join('C:\\ProgramData\\cocos\\editors\\Creator', creatorVersion, 'CocosCreator.exe');
        }
        if (platform === 'darwin') {
            return posix.join(
                '/Applications/Cocos/Creator',
                creatorVersion,
                'CocosCreator.app/Contents/MacOS/CocosCreator',
            );
        }
        return 'CocosCreator';
    }

    /**
     * @description 判断命令行是否属于 Creator 主进程并排除 renderer/helper 子进程。
     * @param commandLine 进程命令行。
     * @returns 命令行属于主进程时返回 true。
     */
    private static _isCreatorMainProcess(commandLine: string): boolean {
        const normalizedCommandLine = commandLine.toLowerCase();
        const isCreator = normalizedCommandLine.includes('cocoscreator') || normalizedCommandLine.includes('cocos creator');
        return isCreator && !normalizedCommandLine.includes('helper') && !normalizedCommandLine.includes('--type=');
    }

    /**
     * @description 从 Creator 命令行提取 `--project` 或 `--path` 的完整参数值。
     * @param commandLine Creator 主进程命令行。
     * @returns 参数值；未提供合法参数时为 null。
     */
    private static _extractProjectArgument(commandLine: string): string | null {
        for (const argumentName of ['--project', '--path']) {
            const pattern = new RegExp(
                `(?:^|\\s)${argumentName}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))(?=\\s|$)`,
                'iu',
            );
            const match = pattern.exec(commandLine);
            const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
            if (value != null && value.trim().length > 0) {
                return value.trim();
            }
        }
        return null;
    }

    /**
     * @description 按目标平台归一化工程路径，Windows 比较忽略大小写，macOS 保留大小写。
     * @param value 待归一化工程路径。
     * @param platform 路径所属平台。
     * @returns 使用正斜杠的稳定比较值。
     */
    private static _normalizeProjectPath(value: string, platform: NodeJS.Platform): string {
        const pathApi = platform === 'win32' ? win32 : posix;
        const normalizedPath = pathApi.resolve(value).replace(/\\/gu, '/').replace(/\/$/u, '');
        return platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    }
}
